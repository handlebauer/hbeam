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
import { blank, bold, cyan, dim, log, logError, write, writeBlock } from '@/lib/log.ts'
import { runBeamSession } from '@/lib/session.ts'

import { Beam } from './beam.ts'
import { runConnectCommand } from './commands/connect.ts'
import { runExposeCommand } from './commands/expose.ts'
import { runGatewayCommand } from './commands/gateway.ts'
import { runOpenCommand } from './commands/open.ts'
import { runPeersCommand } from './commands/peers.ts'
import { runServeCommand } from './commands/serve.ts'
import { runWhoamiCommand } from './commands/whoami.ts'

import type { BeamOptions } from './types.ts'

const ARGV_OFFSET = 2
const EXIT_FAILURE = 1
const EXIT_SUCCESS = 0

const NO_INDENT = ''

const argv = mri(process.argv.slice(ARGV_OFFSET), {
	alias: { h: 'help', o: 'output', p: 'port', t: 'temp', v: 'version' },
	boolean: ['help', 'temp', 'version'],
	string: ['host', 'output', 'port'],
})

if (argv.help) {
	writeBlock([
		`${bold('hbeam')} — end-to-end encrypted pipe over HyperDHT`,
		'',
		`${bold('Usage:')}`,
		`  hbeam ${dim('[passphrase]')} ${dim('[options]')}`,
		`  hbeam connect ${dim('<name>')} ${dim('[options]')}`,
		`  hbeam open ${dim('<name|passphrase|public-key>')} ${dim('[options]')}`,
		`  hbeam expose ${dim('<port>')} ${dim('[options]')}`,
		`  hbeam gateway ${dim('[options]')}`,
		`  hbeam peers ${dim('<add|rm|ls> ...')}`,
		`  hbeam serve ${dim('<file>')} ${dim('[--temp]')}`,
		`  hbeam whoami`,
		'',
		`${bold('Options:')}`,
		`  ${dim('-t, --temp')}     Use one-time passphrase mode`,
		`  ${dim('-o, --output')}   Save incoming file to a specific path`,
		`  ${dim('-p, --port')}     Local listen port (open/gateway mode)`,
		`  ${dim('--host')}         Target/listen host (expose mode)`,
		`  ${dim('-h, --help')}     Show this help`,
		`  ${dim('-v, --version')}  Show version`,
		'',
		`${bold('Examples:')}`,
		`  ${dim('# Start a pipe on your persistent identity')}`,
		"  echo 'hello' | hbeam",
		'',
		`  ${dim('# Start a one-time pipe (generates a passphrase)')}`,
		"  echo 'hello' | hbeam --temp",
		'',
		`  ${dim('# Connect to an existing pipe')}`,
		'  hbeam <passphrase>',
		'',
		`  ${dim('# Announce with a specific passphrase')}`,
		"  echo 'hello again' | hbeam <passphrase> --temp",
		'',
		`  ${dim('# Save and connect to peers by name')}`,
		'  hbeam peers add workserver <public-key>',
		'  hbeam connect workserver',
		'',
		`  ${dim('# Expose local port 3000 over P2P')}`,
		'  hbeam expose 3000',
		'',
		`  ${dim('# Expose local port 3000 with a one-time passphrase')}`,
		'  hbeam expose 3000 --temp',
		'',
		`  ${dim('# Open a remote app in your browser')}`,
		'  hbeam open workserver',
		'',
		`  ${dim('# Open on a fixed local port')}`,
		'  hbeam open workserver -p 8080',
		'',
		`  ${dim('# Route localhost subdomains to peers')}`,
		'  hbeam gateway -p 9000',
		'  open http://workserver.localhost:9000/',
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
	if (argv.port !== undefined) {
		blank()
		logError('`connect -p` has been removed. Use `hbeam open <target> [-p <port>]`.')
		blank()
		process.exit(EXIT_FAILURE)
	}

	await runConnectCommand(restArgs, { outputPath: argv.output })
	ranSubcommand = true
}

if (firstArg === 'open') {
	await runOpenCommand(restArgs, { port: argv.port, temp: argv.temp })
	ranSubcommand = true
}

if (firstArg === 'expose') {
	await runExposeCommand(restArgs, { host: argv.host, temp: argv.temp })
	ranSubcommand = true
}

if (firstArg === 'gateway') {
	await runGatewayCommand(restArgs, { port: argv.port, temp: argv.temp })
	ranSubcommand = true
}

if (firstArg === 'serve') {
	await runServeCommand(restArgs, { temp: argv.temp })
	ranSubcommand = true
}

if (firstArg === 'whoami') {
	process.exit(await runWhoamiCommand())
}

if (!ranSubcommand) {
	const passphrase = firstArg

	if (!argv.temp && !passphrase) {
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
		const beamOptions: BeamOptions | undefined = argv.temp ? { announce: true } : undefined
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
