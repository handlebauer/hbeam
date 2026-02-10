import { createHash } from 'node:crypto'

import * as b4a from 'b4a'
import DHT from 'hyperdht'

import { fromBase32 } from './encoding.ts'

import type { EncryptedSocket, HyperDHTNode, KeyPair } from '../types.ts'

const KEY_SEED_BYTES = 32

/**
 * Normalize an arbitrary decoded seed into exactly 32 bytes.
 *
 * HyperDHT's `keyPair()` behavior for non-32-byte seeds can differ across JS
 * runtimes (e.g. Node vs Bun). By hashing to 32 bytes we ensure both sides
 * derive the same keypair for a given passphrase.
 */
function normalizeSeed(seed: Buffer): Buffer {
	if (seed.length === KEY_SEED_BYTES) {
		return seed
	}
	const digest = createHash('sha256').update(seed).digest()
	return b4a.from(digest)
}

/** Derive a Noise keypair from a base32-encoded passphrase. */
export function deriveKeyPair(passphrase: string): KeyPair {
	const seed = fromBase32(passphrase)
	return DHT.keyPair(normalizeSeed(seed))
}

/** Create an ephemeral HyperDHT node that is destroyed with the beam. */
export function createNode(): HyperDHTNode {
	return new DHT({ ephemeral: true }) as unknown as HyperDHTNode
}

/** Wait for an encrypted socket to complete its Noise handshake. */
export function awaitOpen(socket: EncryptedSocket): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		socket.once('open', resolve)
		socket.once('close', reject)
		socket.once('error', reject)
	})
}

/** Create a firewall that rejects any connection not matching the keypair. */
export function createFirewall(keyPair: KeyPair): (remotePublicKey: Buffer) => boolean {
	return (remotePublicKey: Buffer) => !b4a.equals(remotePublicKey, keyPair.publicKey)
}
