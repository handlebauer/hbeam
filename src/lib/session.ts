/**
 * Shared interactive session runtime for announce/connect flows.
 *
 * Handles spinner/lifecycle output, stream piping behavior, and protocol-aware
 * file-receive mode with completion acknowledgements.
 *
 * @module
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
	encodeCompletionAck,
	findHeaderLineEnd,
	formatFileSize,
	isFileHeader,
	parseFileHeader,
} from './file-protocol.ts'
import { createLifecycle } from './lifecycle.ts'
import {
	blank,
	bold,
	createSpinner,
	cyan,
	dim,
	gray,
	INDENT,
	log,
	logError,
	red,
	SEPARATOR,
	write,
} from './log.ts'
import { confirm, input } from './prompt.ts'
import { createPulseFrames } from './pulse.ts'

import type { Beam } from '../beam.ts'
import type { ConnectionInfo } from '../types.ts'

type ReceiveMode = 'unknown' | 'pipe' | 'file' | 'file-stdout'

const FIRST_INDEX = 0
const NEXT_OFFSET = 1
const NO_DATA = 0
const KEEPALIVE_MS = 60_000
const CONNECTION_RESET = 'connection reset by peer'

export interface SessionOptions {
	announceLabel?: string
	copyValue?: (text: string) => void
	mode: 'announce' | 'connect'
	outputPath?: string
	value: string
}

/**
 * Run the standard hbeam CLI session UI and stdin/stdout piping.
 *
 * @param beam - Active beam instance for this session.
 * @param options - Session rendering and behavior options.
 * @returns Nothing.
 */
export function runBeamSession(beam: Beam, options: SessionOptions): void {
	const { frames, intervalMs } = createPulseFrames('HBEAM')
	const spinner = createSpinner(frames, intervalMs)
	const lifecycle = createLifecycle(beam, spinner)

	blank()

	spinner.start()
	spinner.blank()

	if (options.mode === 'announce') {
		spinner.write(dim(options.announceLabel ?? 'PUBLIC KEY'))
		spinner.write(cyan(options.value))
		options.copyValue?.(options.value)
	} else {
		spinner.write(dim('CONNECTING'))
		spinner.write(cyan(options.value))
	}

	beam.on('remote-address', ({ host, port }: ConnectionInfo) => {
		if (lifecycle.done()) {
			return
		}

		if (host) {
			spinner.write(dim(`ONLINE ${gray(`[${host}:${port}]`)}`))
			spinner.blank()
		}
	})

	beam.on('connected', () => {
		if (lifecycle.done()) {
			return
		}

		spinner.stop()
		log(bold('PIPE ACTIVE'))
		write(gray('CTRL+C TO TERMINATE'))
		blank()
	})

	/**
	 * Receive-side state machine:
	 * - unknown: we have not yet decided if stream is plain pipe data or file transfer
	 * - pipe: classic stdin/stdout hbeam mode
	 * - file: file transfer writing to disk
	 * - file-stdout: file transfer streaming bytes to stdout (non-interactive mode)
	 */
	let receiveMode: ReceiveMode = 'unknown'
	let receivedPipeData = false
	let awaitingPrompt = false
	let streamDone = false
	let streamTerminationHandled = false
	let keepAlive: ReturnType<typeof globalThis.setInterval> | undefined = undefined
	let pendingChunks: Buffer[] = []
	let fileStream: ReturnType<typeof createWriteStream> | undefined = undefined
	let filePath: string | undefined = undefined

	/**
	 * Stop and clear the temporary keepalive timer.
	 *
	 * @returns Nothing.
	 */
	function clearKeepAlive(): void {
		if (keepAlive) {
			globalThis.clearInterval(keepAlive)
			keepAlive = undefined
		}
	}

	/**
	 * Flush and close the destination file stream, then send completion ack.
	 *
	 * @returns Nothing.
	 */
	function finalizeFile(): void {
		clearKeepAlive()

		if (!fileStream) {
			return
		}

		fileStream.end(() => {
			log(dim(`SAVED ${filePath ?? ''}`))
			blank()
			beam.write(encodeCompletionAck({ ok: true, type: 'file-complete' }))
			beam.end()
		})

		fileStream = undefined
	}

	/**
	 * Render normal pipe-mode output with visual framing/indentation.
	 *
	 * @param chunk - Raw inbound data chunk.
	 * @returns Nothing.
	 */
	function writePipeChunk(chunk: Buffer): void {
		if (!receivedPipeData) {
			receivedPipeData = true
			write(SEPARATOR)
			blank()
		}

		process.stdout.write(chunk.toString().replace(/^(?!$)/gm, INDENT))
	}

	/**
	 * Finalize receive-side session behavior once stream termination is observed.
	 *
	 * @returns Nothing.
	 */
	function onStreamDone(): void {
		streamDone = true

		/**
		 * Defer finalization until the async prompt flow finishes.
		 */
		if (awaitingPrompt) {
			return
		}

		if (streamTerminationHandled) {
			return
		}

		streamTerminationHandled = true

		if (receiveMode === 'file') {
			finalizeFile()
		} else if (receiveMode === 'file-stdout') {
			beam.write(encodeCompletionAck({ ok: true, type: 'file-complete' }))
			beam.end()
		} else if (receiveMode === 'pipe' && receivedPipeData) {
			blank()
			write(SEPARATOR)
		}
	}

	beam.on('end', onStreamDone)
	beam.on('close', onStreamDone)

	beam.on('error', (error: Error) => {
		spinner.stop()
		const isPeerNotFound = error.message.includes('PEER_NOT_FOUND')
		const isReset = error.message.includes(CONNECTION_RESET)

		if (
			isReset &&
			(awaitingPrompt || receiveMode === 'file' || receiveMode === 'file-stdout')
		) {
			return
		}

		if (isPeerNotFound) {
			log(red(dim('PEER NOT FOUND')))
		} else if (isReset) {
			log(dim('PEER DISCONNECTED'))
		} else {
			logError(error.message)
		}

		blank()

		if (!isPeerNotFound) {
			lifecycle.shutdown()
		}
	})

	/**
	 * Resolve where an incoming file should be written.
	 *
	 * @param fileName - Suggested source filename from header.
	 * @returns Output path, empty string when cancelled, or undefined for stdout mode.
	 */
	async function promptForOutputPath(fileName: string): Promise<string | undefined> {
		if (options.outputPath) {
			return resolve(options.outputPath)
		}

		if (!process.stdout.isTTY) {
			return undefined
		}

		const suggestedPath = resolve(process.cwd(), fileName)
		const shouldSave = await confirm('Save incoming file?')

		if (!shouldSave) {
			return ''
		}

		return await input('Save to:', suggestedPath)
	}

	/**
	 * Initialize file-receive mode from the first header-bearing data chunk.
	 *
	 * @param headerChunk - Initial chunk containing the file header line.
	 * @returns Promise that resolves after file mode setup completes.
	 */
	async function startFileReceive(headerChunk: Buffer): Promise<void> {
		const lineEnd = findHeaderLineEnd(headerChunk)
		const header = parseFileHeader(headerChunk.subarray(FIRST_INDEX, lineEnd))
		const remainder = headerChunk.subarray(lineEnd + NEXT_OFFSET)

		log(dim(`INCOMING FILE ${header.name} (${formatFileSize(header.size)})`))

		process.stdin.unpipe(beam)
		keepAlive = globalThis.setInterval(() => {}, KEEPALIVE_MS)

		awaitingPrompt = true
		const outputPath = await promptForOutputPath(header.name)
		awaitingPrompt = false

		if (outputPath === '') {
			clearKeepAlive()
			log(dim('RECEIVE CANCELLED'))
			blank()
			beam.write(
				encodeCompletionAck({
					ok: false,
					reason: 'cancelled',
					type: 'file-complete',
				}),
			)
			beam.end()
			return
		}

		if (outputPath === undefined) {
			clearKeepAlive()
			receiveMode = 'file-stdout'
			if (remainder.length > NO_DATA) {
				process.stdout.write(remainder)
			}
			return
		}

		receiveMode = 'file'
		filePath = outputPath
		await mkdir(dirname(outputPath), { recursive: true })
		fileStream = createWriteStream(outputPath)
		fileStream.on('error', error => beam.destroy(error))

		if (remainder.length > NO_DATA) {
			fileStream.write(remainder)
		}
	}

	/**
	 * Route a chunk to the active receive-mode sink.
	 *
	 * @param chunk - Inbound data chunk.
	 * @returns Nothing.
	 */
	function routeChunk(chunk: Buffer): void {
		if (receiveMode === 'pipe') {
			writePipeChunk(chunk)
		} else if (receiveMode === 'file') {
			fileStream?.write(chunk)
		} else if (receiveMode === 'file-stdout') {
			process.stdout.write(chunk)
		}
	}

	/**
	 * Replay chunks buffered while interactive prompts were active.
	 *
	 * @returns Nothing.
	 */
	function flushPendingChunks(): void {
		for (const queued of pendingChunks) {
			routeChunk(queued)
		}

		pendingChunks = []
	}

	beam.on('data', (chunk: Buffer) => {
		/**
		 * While prompting, stash inbound chunks and replay afterward.
		 */
		if (awaitingPrompt) {
			pendingChunks.push(chunk)
			return
		}

		if (receiveMode !== 'unknown') {
			routeChunk(chunk)
			return
		}

		pendingChunks.push(chunk)
		const pending = Buffer.concat(pendingChunks)

		if (isFileHeader(pending)) {
			/**
			 * Wait until the full header line arrives before parsing.
			 */
			if (findHeaderLineEnd(pending) < FIRST_INDEX) {
				return
			}

			pendingChunks = []

			void startFileReceive(pending).finally(() => {
				flushPendingChunks()

				if (streamDone) {
					onStreamDone()
				}
			})

			return
		}

		receiveMode = 'pipe'
		pendingChunks = []
		writePipeChunk(pending)
	})

	process.stdin.pipe(beam)

	if (typeof process.stdin.unref === 'function') {
		process.stdin.unref()
	}
}
