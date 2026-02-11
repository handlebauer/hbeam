import { Transform } from 'node:stream'

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
import { createPulseFrames } from './pulse.ts'

import type { Beam } from '../beam.ts'
import type { ConnectionInfo } from '../types.ts'

type SessionMode = 'announce' | 'connect'

export interface SessionOptions {
	announceLabel?: string
	copyValue?: (text: string) => void
	mode: SessionMode
	value: string
}

/** Run the standard hbeam CLI session UI and stdin/stdout piping. */
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

	beam.on('error', (error: Error) => {
		spinner.stop()
		const isPeerNotFound = error.message.includes('PEER_NOT_FOUND')
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

	beam.on('end', () => beam.end())

	let receivedData = false

	const indent = new Transform({
		flush(cb) {
			if (receivedData) {
				blank()
				write(SEPARATOR)
			}
			cb(undefined, '\n')
		},
		transform(chunk: Buffer, _encoding, cb) {
			if (!receivedData) {
				receivedData = true
				write(SEPARATOR)
				blank()
			}
			const lines = chunk.toString().replace(/^(?!$)/gm, INDENT)
			cb(undefined, lines)
		},
	})

	process.stdin.pipe(beam).pipe(indent).pipe(process.stdout)

	if (typeof process.stdin.unref === 'function') {
		process.stdin.unref()
	}
}
