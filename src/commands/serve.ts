/**
 * `hbeam serve` command implementation.
 *
 * Announces a sender endpoint, streams one file with a control header,
 * and waits for protocol-level completion acknowledgement from receiver.
 *
 * @module
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { Beam } from '@/beam.ts'
import { copyToClipboard } from '@/lib/clipboard.ts'
import {
	encodeHeader,
	findHeaderLineEnd,
	formatFileSize,
	parseCompletionAck,
} from '@/lib/file-protocol.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { createLifecycle } from '@/lib/lifecycle.ts'
import {
	blank,
	bold,
	createSpinner,
	cyan,
	dim,
	gray,
	log,
	logError,
	red,
	write,
} from '@/lib/log.ts'
import { createPulseFrames } from '@/lib/pulse.ts'

import type { ConnectionInfo, KeyPair } from '@/types.ts'

const EXIT_FAILURE = 1
const MIN_FILE_SIZE = 0
const ACK_TIMEOUT_MS = 15_000
const EMPTY_BUFFER_SIZE = 0
const EMPTY_BUFFER = Buffer.alloc(EMPTY_BUFFER_SIZE)
const FIRST_INDEX = 0
const NEXT_OFFSET = 1

interface ServeCommandOptions {
	listen?: boolean
}

/**
 * Print a serve usage error and terminate with failure.
 *
 * @param message - Error message to display.
 * @returns Never returns (process exits).
 */
function showUsageError(message: string): never {
	blank()
	logError(message)
	write(dim('Usage: hbeam serve <file> [--listen]'))
	blank()
	process.exit(EXIT_FAILURE)
}

/**
 * Resolve identity mode for the serve command.
 *
 * @param listen - Whether identity listen mode was requested.
 * @returns Announce label plus optional keypair override.
 */
async function resolveServeIdentity(listen: boolean | undefined): Promise<{
	announceLabel: string
	keyPair?: KeyPair
}> {
	if (!listen) {
		return { announceLabel: 'PASSPHRASE' }
	}
	const identity = await loadOrCreateIdentityWithMeta()
	if (identity.created) {
		blank()
		log(dim('IDENTITY CREATED'))
		write(cyan(identity.keyPair.publicKey.toString('hex')))
	}
	return {
		announceLabel: 'PUBLIC KEY',
		keyPair: identity.keyPair,
	}
}

/**
 * Execute `hbeam serve <file>` to transfer one file to the first peer.
 *
 * @param argv - Positional command arguments after `serve`.
 * @param options - Optional command flags.
 * @returns Promise that resolves when command setup is complete.
 */
export async function runServeCommand(
	argv: string[],
	options: ServeCommandOptions = {},
): Promise<void> {
	const [targetFile] = argv

	if (!targetFile) {
		showUsageError('Missing file path.')
	}

	const filePath = resolve(targetFile)
	const fileName = basename(filePath)
	const fileStat = await stat(filePath).catch(() => undefined)

	if (!fileStat || !fileStat.isFile()) {
		showUsageError(`Not a readable file: ${targetFile}`)
	}

	if (fileStat.size < MIN_FILE_SIZE) {
		showUsageError(`Invalid file size: ${targetFile}`)
	}

	const identity = await resolveServeIdentity(options.listen)
	const beam = identity.keyPair
		? new Beam({ announce: true, keyPair: identity.keyPair })
		: new Beam(undefined, { announce: true })

	const { frames, intervalMs } = createPulseFrames('HBEAM')
	const spinner = createSpinner(frames, intervalMs)
	const lifecycle = createLifecycle(beam, spinner)

	let awaitingAck = false
	let ackBuffer = EMPTY_BUFFER
	let ackTimeout: ReturnType<typeof globalThis.setTimeout> | undefined = undefined

	/**
	 * Tear down transfer resources and destroy the beam.
	 *
	 * @returns Nothing.
	 */
	function closeTransfer(): void {
		if (ackTimeout) {
			globalThis.clearTimeout(ackTimeout)
			ackTimeout = undefined
		}

		beam.destroy()
	}

	blank()

	spinner.start()
	spinner.blank()
	spinner.write(dim(identity.announceLabel))
	spinner.write(cyan(beam.key))
	spinner.write(dim(`FILE ${fileName} (${formatFileSize(fileStat.size)})`))

	copyToClipboard(beam.key)

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
		write(gray('SENDING FILE'))
		blank()

		const header = encodeHeader({ name: fileName, size: fileStat.size, type: 'file' })
		if (beam.write(header) === false) {
			beam.once('drain', () => createReadStream(filePath).pipe(beam))
			return
		}
		createReadStream(filePath).pipe(beam)
	})

	beam.on('error', (error: Error) => {
		spinner.stop()
		const isPeerNotFound = error.message.includes('PEER_NOT_FOUND')
		if (awaitingAck && error.message.includes('connection reset by peer')) {
			logError('Receiver closed before completion acknowledgement.')
			blank()
			closeTransfer()
			return
		}
		if (isPeerNotFound) {
			log(red(dim('PEER NOT FOUND')))
		} else if (error.message.includes('connection reset by peer')) {
			log(dim('PEER DISCONNECTED'))
		} else {
			logError(error.message)
		}
		blank()
		if (!isPeerNotFound) {
			lifecycle.shutdown()
		}
	})

	beam.on('data', (chunk: Buffer) => {
		if (!awaitingAck) {
			return
		}
		ackBuffer = Buffer.concat([ackBuffer, chunk])
		/**
		 * Acks are newline-delimited JSON control frames, so we parse line-by-line
		 * and ignore unrelated payload chunks until a valid ack appears.
		 */
		while (true) {
			const lineEnd = findHeaderLineEnd(ackBuffer)

			if (lineEnd < FIRST_INDEX) {
				return
			}

			const line = ackBuffer.subarray(FIRST_INDEX, lineEnd)
			ackBuffer = ackBuffer.subarray(lineEnd + NEXT_OFFSET)
			const ack = parseCompletionAck(line)

			if (ack) {
				awaitingAck = false
				if (ack.ok) {
					log(dim('RECEIVER CONFIRMED'))
				} else {
					logError(`Receiver declined file${ack.reason ? `: ${ack.reason}` : '.'}`)
				}
				blank()
				closeTransfer()
				return
			}
		}
	})

	beam.on('end', () => beam.end())
	beam.on('finish', () => {
		log(dim('FILE SENT'))
		write(dim('WAITING FOR RECEIVER ACK'))
		blank()
		awaitingAck = true
		ackTimeout = globalThis.setTimeout(() => {
			awaitingAck = false
			logError('Timed out waiting for receiver acknowledgement.')
			blank()
			closeTransfer()
		}, ACK_TIMEOUT_MS)
	})

	/**
	 * Streamx opens lazily; force announce mode to start immediately.
	 */
	;(beam as unknown as { resume(): void }).resume()
}
