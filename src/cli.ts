#!/usr/bin/env node

import { Transform } from 'node:stream'

import mri from 'mri'

import { Beam } from './beam.ts'
import { copyToClipboard } from './lib/clipboard.ts'
import { createLifecycle } from './lib/lifecycle.ts'
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
	writeBlock,
} from './lib/log.ts'
import { createPulseFrames } from './lib/pulse.ts'

import type { BeamOptions, ConnectionInfo } from './types.ts'

const ARGV_OFFSET = 2
const EXIT_SUCCESS = 0
const EXIT_FAILURE = 1

const argv = mri(process.argv.slice(ARGV_OFFSET), {
	alias: { h: 'help', l: 'listen', v: 'version' },
	boolean: ['help', 'listen', 'version'],
})

if (argv.help) {
	writeBlock([
		`${bold('hbeam')} — end-to-end encrypted pipe over HyperDHT`,
		'',
		`${bold('Usage:')}`,
		`  hbeam ${dim('[passphrase]')} ${dim('[options]')}`,
		'',
		`${bold('Options:')}`,
		`  ${dim('-l, --listen')}   Listen using the provided passphrase`,
		`  ${dim('-h, --help')}     Show this help`,
		`  ${dim('-v, --version')}  Show version`,
		'',
		`${bold('Examples:')}`,
		`  ${dim('# Start a new pipe (generates a passphrase)')}`,
		"  echo 'hello' | hbeam",
		'',
		`  ${dim('# Connect to an existing pipe')}`,
		'  hbeam <passphrase>',
		'',
		`  ${dim('# Listen with a specific passphrase')}`,
		"  echo 'hello again' | hbeam <passphrase> --listen",
	])
	process.exit(EXIT_SUCCESS)
}

if (argv.version) {
	const pkg = (await import('../package.json')) as { version?: string }
	write(pkg.version ?? '0.0.0')
	process.exit(EXIT_SUCCESS)
}

const [passphrase] = argv._ as string[]

if (argv.listen && !passphrase) {
	logError('The --listen flag requires an existing passphrase.')
	write(dim('Usage: hbeam <passphrase> --listen'))
	process.exit(EXIT_FAILURE)
}

const beamOptions: BeamOptions | undefined = argv.listen ? { announce: true } : undefined
const beam = new Beam(passphrase, beamOptions)

const { frames, intervalMs } = createPulseFrames('HBEAM')
const spinner = createSpinner(frames, intervalMs)
const lifecycle = createLifecycle(beam, spinner)

blank()
spinner.start()
spinner.blank()

if (beam.announce) {
	spinner.write(dim('PASSPHRASE'))
	spinner.write(cyan(beam.key))
	copyToClipboard(beam.key)
} else {
	spinner.write(dim('CONNECTING'))
	spinner.write(cyan(passphrase ?? 'unknown'))
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
