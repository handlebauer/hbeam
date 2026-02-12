/**
 * `hbeam expose` command implementation.
 *
 * Creates an encrypted reverse TCP tunnel over HyperDHT
 * (P2P peer -> local TCP service).
 *
 * @module
 */
import { copyToClipboard } from '@/lib/clipboard.ts'
import { createNode, deriveKeyPair, parsePort } from '@/lib/dht.ts'
import { randomBytes, toBase32 } from '@/lib/encoding.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { blank, createSpinner, cyan, dim, gray, log, logError, write } from '@/lib/log.ts'
import { createPulseFrames } from '@/lib/pulse.ts'
import { createReverseTunnel, registerShutdown } from '@/lib/tunnel.ts'

import type { KeyPair } from '@/types.ts'

const EXIT_FAILURE = 1
const DEFAULT_REVERSE_HOST = 'localhost'
const EPHEMERAL_KEY_BYTES = 32

interface ExposeCommandOptions {
	host?: string
	temp?: boolean
}

/**
 * Print an expose usage error and terminate with failure.
 *
 * @param message - Error message to display.
 * @returns Never returns (process exits).
 */
function showUsageError(message: string): never {
	blank()
	logError(message)
	write(dim('Usage: hbeam expose <port> [--host <host>] [--temp]'))
	blank()
	process.exit(EXIT_FAILURE)
}

/**
 * Execute reverse-proxy expose mode (P2P -> local TCP service).
 *
 * @param targetPort - Local service port to expose.
 * @param options - Expose command options.
 * @returns Promise that resolves once expose is running.
 */
async function runReverseExpose(targetPort: number, options: ExposeCommandOptions): Promise<void> {
	const host = options.host ?? DEFAULT_REVERSE_HOST

	let keyPair: KeyPair | undefined = undefined
	let announceValue: string | undefined = undefined

	if (options.temp) {
		announceValue = toBase32(randomBytes(EPHEMERAL_KEY_BYTES))
		keyPair = deriveKeyPair(announceValue)

		copyToClipboard(announceValue)
	} else {
		const identity = await loadOrCreateIdentityWithMeta()

		keyPair = identity.keyPair
		announceValue = identity.keyPair.publicKey.toString('hex')

		if (identity.created) {
			blank()
			log(dim('IDENTITY CREATED'))
			write(cyan(announceValue))
		}
	}

	if (!keyPair || !announceValue) {
		showUsageError('Failed to initialize expose identity.')
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
 * Execute `hbeam expose` (reverse proxy mode).
 *
 * @param argv - Positional command arguments after `expose`.
 * @param options - Optional command flags.
 * @returns Promise that resolves when command setup completes.
 */
export async function runExposeCommand(
	argv: string[],
	options: ExposeCommandOptions = {},
): Promise<void> {
	const [target] = argv

	if (!target) {
		showUsageError('Missing target port.')
	}

	let targetPort = 0

	try {
		targetPort = parsePort(target, 'target port')
	} catch (error) {
		showUsageError((error as Error).message)
	}

	await runReverseExpose(targetPort, options)
}
