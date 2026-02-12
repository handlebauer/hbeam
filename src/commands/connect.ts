/**
 * `hbeam connect` command implementation.
 *
 * Supports two modes:
 * - Pipe mode: connect to a saved peer name and start a beam session.
 *
 * @module
 */
import { getPeer } from '@/lib/addressbook.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { blank, cyan, dim, log, logError, write } from '@/lib/log.ts'
import { runBeamSession } from '@/lib/session.ts'

import { Beam } from '../beam.ts'

const EXIT_FAILURE = 1
const PUBLIC_KEY_BYTES = 32

interface ConnectCommandOptions {
	outputPath?: string
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
	write(dim('Usage: hbeam connect <name>'))
	blank()
	process.exit(EXIT_FAILURE)
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
