/**
 * `hbeam whoami` command implementation.
 *
 * Displays the local persistent identity public key and copies it
 * to the system clipboard for easy sharing.
 *
 * @module
 */
import { copyToClipboard } from '@/lib/clipboard.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import { blank, bold, cyan, dim, log, write } from '@/lib/log.ts'

const EXIT_SUCCESS = 0

/**
 * Execute `hbeam whoami`.
 *
 * @returns Process exit code.
 */
export async function runWhoamiCommand(): Promise<number> {
	const identity = await loadOrCreateIdentityWithMeta()
	const publicKey = identity.keyPair.publicKey.toString('hex')

	blank()

	if (identity.created) {
		log(dim('IDENTITY CREATED'))
	}

	log(bold('IDENTITY'))
	write(cyan(publicKey))
	copyToClipboard(publicKey)

	blank()

	return EXIT_SUCCESS
}
