#!/usr/bin/env node

/**
 * Command-line entrypoint for the hbeam executable.
 *
 * Parses CLI flags/arguments, routes to subcommands, and starts
 * interactive announce/connect sessions for pipe and file-transfer flows.
 *
 * @module
 */
import mri from 'mri'

import { copyToClipboard } from '@/lib/clipboard.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { bold, cyan, dim, log, write, writeBlock } from '@/lib/log.ts'
import { runBeamSession } from '@/lib/session.ts'

import { Beam } from './beam.ts'
import { runBindCommand } from './commands/bind.ts'
import { runConnectCommand } from './commands/connect.ts'
import { runPeersCommand } from './commands/peers.ts'
import { runServeCommand } from './commands/serve.ts'
import { runWhoamiCommand } from './commands/whoami.ts'

import type { BeamOptions } from './types.ts'

const ARGV_OFFSET = 2
const EXIT_SUCCESS = 0

const NO_INDENT = ''

const argv = mri(process.argv.slice(ARGV_OFFSET), {
	alias: { h: 'help', l: 'listen', o: 'output', p: 'port', v: 'version' },
	boolean: ['help', 'listen', 'version'],
	string: ['host', 'output', 'port'],
})

if (argv.help) {
	writeBlock([
		`${bold('hbeam')} — end-to-end encrypted pipe over HyperDHT`,
		'',
		`${bold('Usage:')}`,
		`  hbeam ${dim('[passphrase]')} ${dim('[options]')}`,
		`  hbeam connect ${dim('<name>')}`,
		`  hbeam bind ${dim('<port|passphrase|name|public-key>')} ${dim('[options]')}`,
		`  hbeam peers ${dim('<add|rm|ls> ...')}`,
		`  hbeam serve ${dim('<file>')} ${dim('[--listen]')}`,
		`  hbeam whoami`,
		'',
		`${bold('Options:')}`,
		`  ${dim('-l, --listen')}   Listen using passphrase or identity`,
		`  ${dim('-o, --output')}   Save incoming file to a specific path`,
		`  ${dim('-p, --port')}     Local listen port (bind forward mode)`,
		`  ${dim('--host')}         Host target/listen host (bind mode)`,
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
		'',
		`  ${dim('# Listen on your persistent identity')}`,
		'  hbeam --listen',
		'',
		`  ${dim('# Save and connect to peers by name')}`,
		'  hbeam peers add workserver <public-key>',
		'  hbeam connect workserver',
		'',
		`  ${dim('# Expose local port 3000 over P2P')}`,
		'  hbeam bind 3000 --listen',
		'',
		`  ${dim('# Create local TCP tunnel to remote peer')}`,
		'  hbeam bind workserver -p 8080',
		'',
		`  ${dim('# Serve a single file')}`,
		'  hbeam serve ./report.pdf',
	])
	process.exit(EXIT_SUCCESS)
}

if (argv.version) {
	const pkg = (await import('../package.json')) as { version?: string }
	write(pkg.version ?? '0.0.0', NO_INDENT)
	process.exit(EXIT_SUCCESS)
}

const [firstArg, ...restArgs] = argv._ as string[]
let ranSubcommand = false

if (firstArg === 'peers') {
	process.exit(await runPeersCommand(restArgs))
}
if (firstArg === 'connect') {
	await runConnectCommand(restArgs, { outputPath: argv.output })
	ranSubcommand = true
}
if (firstArg === 'bind') {
	await runBindCommand(restArgs, { host: argv.host, listen: argv.listen, port: argv.port })
	ranSubcommand = true
}
if (firstArg === 'serve') {
	await runServeCommand(restArgs, { listen: argv.listen })
	ranSubcommand = true
}
if (firstArg === 'whoami') {
	process.exit(await runWhoamiCommand())
}

if (!ranSubcommand) {
	const passphrase = firstArg

	if (argv.listen && !passphrase) {
		const identity = await loadOrCreateIdentityWithMeta()
		if (identity.created) {
			log(dim('IDENTITY CREATED'))
			write(cyan(identity.keyPair.publicKey.toString('hex')))
		}

		const beam = new Beam({
			announce: true,
			keyPair: identity.keyPair,
		})
		runBeamSession(beam, {
			announceLabel: 'ANNOUNCING',
			copyValue: copyToClipboard,
			mode: 'announce',
			value: beam.key,
		})
	} else {
		const beamOptions: BeamOptions | undefined = argv.listen ? { announce: true } : undefined
		const beam = new Beam(passphrase, beamOptions)
		runBeamSession(beam, {
			announceLabel: 'ANNOUNCING',
			copyValue: copyToClipboard,
			mode: beam.announce ? 'announce' : 'connect',
			outputPath: argv.output,
			value: beam.announce ? beam.key : (passphrase ?? 'unknown'),
		})
	}
}
