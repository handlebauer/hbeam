/**
 * HyperDHT integration helpers used by the Beam transport.
 *
 * Includes deterministic key derivation, ephemeral node creation,
 * socket open synchronization, and inbound firewall generation.
 *
 * @module
 */
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
 *
 * @param seed - Decoded passphrase seed bytes.
 * @returns A 32-byte normalized seed.
 */
function normalizeSeed(seed: Buffer): Buffer {
	if (seed.length === KEY_SEED_BYTES) {
		return seed
	}
	const digest = createHash('sha256').update(seed).digest()
	return b4a.from(digest)
}

/**
 * Derive a Noise keypair from a base32-encoded passphrase.
 *
 * @param passphrase - Shared base32 passphrase.
 * @returns Deterministic Noise keypair derived from the passphrase.
 */
export function deriveKeyPair(passphrase: string): KeyPair {
	const seed = fromBase32(passphrase)
	return DHT.keyPair(normalizeSeed(seed))
}

/**
 * Create an ephemeral HyperDHT node that is destroyed with the beam.
 *
 * @returns New ephemeral HyperDHT node instance.
 */
export function createNode(): HyperDHTNode {
	return new DHT({ ephemeral: true }) as unknown as HyperDHTNode
}

/**
 * Wait for an encrypted socket to complete its Noise handshake.
 *
 * @param socket - Socket to await open/close/error on.
 * @returns Promise that resolves when the socket opens.
 */
export function awaitOpen(socket: EncryptedSocket): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		socket.once('open', resolve)
		socket.once('close', reject)
		socket.once('error', reject)
	})
}

/**
 * Create a firewall that rejects connections not matching the expected keypair.
 *
 * @param keyPair - Local keypair used to validate remote key.
 * @returns Predicate used by HyperDHT server firewall.
 */
export function createFirewall(keyPair: KeyPair): (remotePublicKey: Buffer) => boolean {
	return (remotePublicKey: Buffer) => !b4a.equals(remotePublicKey, keyPair.publicKey)
}
