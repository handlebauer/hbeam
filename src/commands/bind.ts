/**
 * `hbeam bind` command implementation.
 *
 * Creates encrypted TCP tunnels over HyperDHT in either reverse mode
 * (P2P -> local TCP service) or forward mode (local TCP -> P2P peer).
 *
 * @module
 */
import { copyToClipboard } from '@/lib/clipboard.ts'
import { createNode, deriveKeyPair, resolveRemoteKey } from '@/lib/dht.ts'
import { randomBytes, toBase32 } from '@/lib/encoding.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import {
	blank,
	clearLine,
	createSpinner,
	cyan,
	dim,
	endInline,
	gray,
	log,
	logError,
	type Spinner,
	write,
	writeInline,
} from '@/lib/log.ts'
import { createPulseFrames } from '@/lib/pulse.ts'
import { createForwardTunnel, createReverseTunnel } from '@/lib/tunnel.ts'

import type { KeyPair, TunnelController } from '@/types.ts'

const EXIT_FAILURE = 1
const EXIT_SUCCESS = 0
const EPHEMERAL_KEY_BYTES = 32
const DEFAULT_REVERSE_HOST = 'localhost'
const DEFAULT_FORWARD_HOST = '127.0.0.1'
const MIN_PORT = 1
const MAX_PORT = 65_535
const RANDOM_PORT = 0
const FIRST_ACTIVE_CONNECTION = 1
const NO_ACTIVE_CONNECTIONS = 0
const KEY_PREFIX_START = 0
const SHORT_KEY_PREFIX = 12

/**
 * Render a short public-key hint for status lines.
 *
 * @param publicKey - Hex public key.
 * @returns Short key preview.
 */
function shortenKey(publicKey: string): string {
	if (publicKey.length <= SHORT_KEY_PREFIX) {
		return publicKey
	}
	return `${publicKey.slice(KEY_PREFIX_START, SHORT_KEY_PREFIX)}...`
}

interface BindCommandOptions {
	host?: string
	listen?: boolean
	port?: number | string
}

/**
 * Determine whether a tunnel error is a non-fatal per-connection close.
 *
 * @param error - Error emitted by tunnel internals.
 * @returns True when bind should continue running.
 */
function isBenignConnectionError(error: Error): boolean {
	const message = error.message.toLowerCase()
	const code = (error as NodeJS.ErrnoException).code?.toLowerCase() ?? ''

	return (
		code === 'econnreset' ||
		code === 'epipe' ||
		message.includes('connection reset by peer') ||
		message.includes('writable stream closed prematurely') ||
		message.includes('premature close')
	)
}

/**
 * Print a bind usage error and terminate with failure.
 *
 * @param message - Error message to display.
 * @returns Never returns (process exits).
 */
function showUsageError(message: string): never {
	blank()
	logError(message)
	write(
		dim(
			'Usage: hbeam bind <port|passphrase|name|public-key> [--host <host>] [-p <port>] [--listen]',
		),
	)
	blank()
	process.exit(EXIT_FAILURE)
}

/**
 * Parse and validate a TCP port number.
 *
 * @param value - Port text/number.
 * @param label - Human-readable label used in error messages.
 * @returns Parsed port number.
 */
function parsePort(value: string | number, label: string): number {
	const parsed = typeof value === 'number' ? value : Number(value)
	if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
		showUsageError(`Invalid ${label}: ${value}`)
	}
	return parsed
}

/**
 * Build a throwaway keypair for ephemeral tunnel sessions.
 *
 * @returns Ephemeral keypair derived from random passphrase material.
 */
function createEphemeralKeyPair(): KeyPair {
	const passphrase = toBase32(randomBytes(EPHEMERAL_KEY_BYTES))
	return deriveKeyPair(passphrase)
}

/**
 * Register SIGINT/SIGTERM handlers and close resources once.
 *
 * @param tunnel - Active tunnel controller.
 * @returns Nothing.
 */
function registerShutdown(tunnel: TunnelController, spinner: Spinner): void {
	let shuttingDown = false
	let spinnerStopped = false

	function stopSpinnerOnce(): void {
		if (spinnerStopped) {
			return
		}
		spinnerStopped = true
		spinner.stop()
	}

	async function shutdown(exitCode: number): Promise<void> {
		if (shuttingDown) {
			return
		}
		shuttingDown = true
		stopSpinnerOnce()
		blank()
		log(dim('SHUTTING DOWN'))
		blank()
		await tunnel.close().catch(() => {})
		process.exit(exitCode)
	}

	process.once('SIGINT', () => {
		clearLine()
		void shutdown(EXIT_SUCCESS)
	})
	process.once('SIGTERM', () => {
		void shutdown(EXIT_SUCCESS)
	})

	tunnel.on('error', error => {
		if (isBenignConnectionError(error)) {
			return
		}
		logError(error.message)
		void shutdown(EXIT_FAILURE)
	})

	/**
	 * Keep bind runtime UX aligned with other commands.
	 * Only log edge transitions to avoid noisy per-connection spam.
	 */
	tunnel.on('connect', event => {
		if (shuttingDown || event.activeConnections !== FIRST_ACTIVE_CONNECTION) {
			return
		}
		stopSpinnerOnce()
		const peerHint = event.remotePublicKey ? ` ${dim(shortenKey(event.remotePublicKey))}` : ''
		writeInline(`SOCKET OPEN${peerHint}`)
	})

	tunnel.on('disconnect', event => {
		if (shuttingDown || event.activeConnections !== NO_ACTIVE_CONNECTIONS) {
			return
		}
		endInline(' CLOSED')
	})
}

/**
 * Execute reverse-proxy bind mode (P2P -> local TCP service).
 *
 * @param targetPort - Local service port to expose.
 * @param options - Bind command options.
 * @returns Promise that resolves once tunnel is running.
 */
async function runReverseBind(targetPort: number, options: BindCommandOptions): Promise<void> {
	const host = options.host ?? DEFAULT_REVERSE_HOST
	let keyPair: KeyPair | undefined = undefined
	let announceValue: string | undefined = undefined

	if (options.listen) {
		const identity = await loadOrCreateIdentityWithMeta()
		keyPair = identity.keyPair
		announceValue = identity.keyPair.publicKey.toString('hex')
		if (identity.created) {
			blank()
			log(dim('IDENTITY CREATED'))
			write(cyan(announceValue))
		}
	} else {
		announceValue = toBase32(randomBytes(EPHEMERAL_KEY_BYTES))
		keyPair = deriveKeyPair(announceValue)
		copyToClipboard(announceValue)
	}

	if (!keyPair || !announceValue) {
		showUsageError('Failed to initialize bind identity.')
	}

	const { frames, intervalMs } = createPulseFrames('HBEAM')
	const spinner = createSpinner(frames, intervalMs)
	const node = createNode()

	blank()
	spinner.start()
	spinner.blank()
	spinner.write(dim('ANNOUNCING'))
	spinner.write(cyan(announceValue))

	const tunnel = await createReverseTunnel({
		dht: node,
		host,
		keyPair,
		port: targetPort,
	})

	spinner.write(dim(`ONLINE ${gray(`[${node.host}:${node.port}]`)}`))
	spinner.blank()
	spinner.write(`FORWARDING ${dim(`${host}:${targetPort}`)}`)
	spinner.blank()

	registerShutdown(tunnel, spinner)
}

/**
 * Execute forward-proxy bind mode (local TCP -> P2P peer).
 *
 * @param target - Remote target (peer name, passphrase, or public key).
 * @param options - Bind command options.
 * @returns Promise that resolves once tunnel is running.
 */
async function runForwardBind(target: string, options: BindCommandOptions): Promise<void> {
	const remotePublicKey = await resolveRemoteKey(target)
	let keyPair: KeyPair | undefined = undefined

	if (options.listen) {
		const identity = await loadOrCreateIdentityWithMeta()
		keyPair = identity.keyPair
	} else {
		keyPair = createEphemeralKeyPair()
	}

	if (!keyPair) {
		showUsageError('Failed to initialize bind identity.')
	}

	const listenHost = options.host ?? DEFAULT_FORWARD_HOST
	const listenPort = options.port ? parsePort(options.port, 'listen port') : RANDOM_PORT

	const { frames, intervalMs } = createPulseFrames('HBEAM')
	const spinner = createSpinner(frames, intervalMs)
	const node = createNode()

	blank()

	spinner.start()
	spinner.blank()
	spinner.write(dim(`CONNECTING ${target}`))

	const tunnel = await createForwardTunnel({
		dht: node,
		host: listenHost,
		keyPair,
		port: listenPort,
		remotePublicKey,
	})

	const boundPort = tunnel.listenPort ?? listenPort

	spinner.write(`LISTENING ${dim(`${listenHost}:${boundPort}`)}`)
	spinner.blank()

	registerShutdown(tunnel, spinner)
}

/**
 * Execute `hbeam bind` in reverse or forward proxy mode.
 *
 * @param argv - Positional command arguments after `bind`.
 * @param options - Optional command flags.
 * @returns Promise that resolves when command setup completes.
 */
export async function runBindCommand(
	argv: string[],
	options: BindCommandOptions = {},
): Promise<void> {
	const [target] = argv

	if (!target) {
		showUsageError('Missing target argument.')
	}

	if (/^\d+$/.test(target)) {
		await runReverseBind(parsePort(target, 'target port'), options)

		return
	}

	await runForwardBind(target, options)
}
