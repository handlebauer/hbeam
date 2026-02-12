/**
 * `hbeam connect` command implementation.
 *
 * Supports two modes:
 * - Pipe mode: connect to a saved peer name and start a beam session.
 * - Forward mode (`-p`): connect to a remote target and expose it locally.
 *
 * @module
 */
import { getPeer } from '@/lib/addressbook.ts'
import { createNode, createEphemeralKeyPair, resolveRemoteKey, parsePort } from '@/lib/dht.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { blank, createSpinner, cyan, dim, gray, green, log, logError, write } from '@/lib/log.ts'
import { createPulseFrames } from '@/lib/pulse.ts'
import { runBeamSession } from '@/lib/session.ts'
import { createForwardTunnel, registerShutdown } from '@/lib/tunnel.ts'

import { Beam } from '../beam.ts'

const EXIT_FAILURE = 1
const DEFAULT_FORWARD_HOST = '127.0.0.1'
const PUBLIC_KEY_BYTES = 32
const RANDOM_PORT = 0

interface ConnectCommandOptions {
	host?: string
	outputPath?: string
	port?: number | string
	temp?: boolean
}

/**
 * Print a connect usage error and terminate with failure.
 *
 * @param message - Error message to display.
 * @returns Never returns (process exits).
 */
function showUsageError(message: string): never {
	blank()
	logError(message)
	write(
		dim(
			'Usage: hbeam connect <name|passphrase|public-key> [-p <port>] [--host <host>] [--temp]',
		),
	)
	blank()
	process.exit(EXIT_FAILURE)
}

/**
 * Execute forward-proxy connect mode (local TCP -> P2P peer).
 *
 * @param target - Remote target (peer name, passphrase, or public key).
 * @param options - Connect command options.
 * @returns Promise that resolves once forward tunnel is running.
 */
async function runForwardConnect(target: string, options: ConnectCommandOptions): Promise<void> {
	const remotePublicKey = await resolveRemoteKey(target)
	let keyPair = createEphemeralKeyPair()

	if (!options.temp) {
		const identity = await loadOrCreateIdentityWithMeta()
		keyPair = identity.keyPair
		if (identity.created) {
			blank()
			log(dim('IDENTITY CREATED'))
			write(cyan(identity.keyPair.publicKey.toString('hex')))
		}
	}

	const listenHost = options.host ?? DEFAULT_FORWARD_HOST
	let listenPort = RANDOM_PORT

	try {
		listenPort = options.port ? parsePort(options.port, 'listen port') : RANDOM_PORT
	} catch (error) {
		showUsageError((error as Error).message)
	}

	const { frames, intervalMs } = createPulseFrames('HBEAM')
	const spinner = createSpinner(frames, intervalMs)
	const node = createNode()

	blank()
	spinner.start()
	spinner.blank()
	spinner.write(`CONNECTING ${green(target)}`)

	const tunnel = await createForwardTunnel({
		dht: node,
		host: listenHost,
		keyPair,
		port: listenPort,
		remotePublicKey,
	})

	const boundPort = tunnel.listenPort ?? listenPort
	if (node.host && node.port > RANDOM_PORT) {
		spinner.write(dim(`ONLINE ${gray(`[${node.host}:${node.port}]`)}`))
		spinner.blank()
	}
	spinner.write(`LISTENING ${dim(`${listenHost}:${boundPort}`)}`)
	spinner.blank()

	registerShutdown(tunnel, spinner)
}

/**
 * Execute `hbeam connect <name>`.
 *
 * @param argv - Positional command arguments after `connect`.
 * @param options - Optional command flags.
 * @returns Promise that resolves when the command has started the session.
 */
export async function runConnectCommand(
	argv: string[],
	options: ConnectCommandOptions = {},
): Promise<void> {
	const [target] = argv

	if (!target) {
		showUsageError('Missing target.')
	}

	if (options.port !== undefined) {
		await runForwardConnect(target, options)
		return
	}

	const name = target
	const peer = await getPeer(name).catch(() => undefined)

	if (!peer) {
		blank()
		logError(`Unknown peer: ${name}`)
		blank()
		process.exit(EXIT_FAILURE)
	}

	const remotePublicKey = Buffer.from(peer.publicKey, 'hex')

	if (remotePublicKey.length !== PUBLIC_KEY_BYTES) {
		blank()
		logError(`Invalid public key for peer: ${name}`)
		blank()
		process.exit(EXIT_FAILURE)
	}

	const identity = await loadOrCreateIdentityWithMeta()

	if (identity.created) {
		blank()
		log(dim('IDENTITY CREATED'))
		write(cyan(identity.keyPair.publicKey.toString('hex')))
	}

	const beam = new Beam({
		keyPair: identity.keyPair,
		remotePublicKey,
	})

	runBeamSession(beam, {
		mode: 'connect',
		outputPath: options.outputPath,
		value: name,
	})
}
