/**
 * `hbeam open` command implementation.
 *
 * Opens a remote peer's HTTP service in the local browser by creating
 * a local TCP endpoint backed by a P2P forward tunnel.
 *
 * @module
 */
import { openBrowser } from '@/lib/browser.ts'
import { createNode, createEphemeralKeyPair, parsePort, resolveRemoteKey } from '@/lib/dht.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { blank, createSpinner, cyan, dim, gray, green, log, logError, write } from '@/lib/log.ts'
import { createPulseFrames } from '@/lib/pulse.ts'
import { createForwardTunnel, registerShutdown } from '@/lib/tunnel.ts'

const EXIT_FAILURE = 1
const DEFAULT_OPEN_HOST = '127.0.0.1'
const RANDOM_PORT = 0

interface OpenCommandOptions {
	port?: number | string
	temp?: boolean
}

/**
 * Print an open usage error and terminate with failure.
 *
 * @param message - Error message to display.
 * @returns Never returns (process exits).
 */
function showUsageError(message: string): never {
	blank()
	logError(message)
	write(dim('Usage: hbeam open <name|passphrase|public-key> [-p <port>] [--temp]'))
	blank()
	process.exit(EXIT_FAILURE)
}

/**
 * Execute `hbeam open`.
 *
 * @param argv - Positional command arguments after `open`.
 * @param options - Optional command flags.
 * @returns Promise that resolves when command setup completes.
 */
export async function runOpenCommand(
	argv: string[],
	options: OpenCommandOptions = {},
): Promise<void> {
	const [target] = argv
	if (!target) {
		showUsageError('Missing target.')
	}

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
		host: DEFAULT_OPEN_HOST,
		keyPair,
		port: listenPort,
		remotePublicKey,
	})

	const boundPort = tunnel.listenPort ?? listenPort
	const openedUrl = `http://${DEFAULT_OPEN_HOST}:${boundPort}/`

	if (node.host && node.port > RANDOM_PORT) {
		spinner.write(dim(`ONLINE ${gray(`[${node.host}:${node.port}]`)}`))
		spinner.blank()
	}

	try {
		await openBrowser(openedUrl)
		spinner.write(`OPENED ${cyan(openedUrl)}`)
	} catch {
		spinner.write(`LISTENING ${dim(`${DEFAULT_OPEN_HOST}:${boundPort}`)}`)
		spinner.write(dim(`OPEN FAILED ${openedUrl}`))
	}
	spinner.blank()

	registerShutdown(tunnel, spinner)
}
