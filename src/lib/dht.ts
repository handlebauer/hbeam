import * as b4a from 'b4a'
import DHT from 'hyperdht'

import { fromBase32 } from './encoding.ts'

import type { EncryptedSocket, HyperDHTNode, KeyPair } from '../types.ts'

/** Derive a Noise keypair from a base32-encoded passphrase. */
export function deriveKeyPair(passphrase: string): KeyPair {
	return DHT.keyPair(fromBase32(passphrase))
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
