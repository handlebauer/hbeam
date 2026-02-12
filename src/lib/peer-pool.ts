/**
 * Reusable encrypted-socket pool keyed by remote public key.
 *
 * Supports on-demand acquisition with idle eviction for gateway-style HTTP
 * proxying over HyperDHT sockets.
 *
 * @module
 */
import { awaitOpen } from '@/lib/dht.ts'

import type { EncryptedSocket, HyperDHTNode, KeyPair } from '@/types.ts'

const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const NO_ENTRIES = 0

interface PooledSocket {
	idleTimer?: ReturnType<typeof globalThis.setTimeout>
	key: string
	socket: EncryptedSocket
	busy: boolean
}

export interface PeerPool {
	acquire(remotePublicKey: Buffer): Promise<EncryptedSocket>
	release(remotePublicKey: Buffer, socket: EncryptedSocket): void
	close(): Promise<void>
}

interface PeerPoolOptions {
	idleTimeoutMs?: number
}

/**
 * Create a pooled encrypted-socket manager for remote peers.
 *
 * @param node - Shared HyperDHT node.
 * @param keyPair - Local identity used for outbound auth.
 * @param options - Optional pool behavior overrides.
 * @returns Peer pool with acquire/release/close lifecycle.
 */
export function createPeerPool(
	node: HyperDHTNode,
	keyPair: KeyPair,
	options: PeerPoolOptions = {},
): PeerPool {
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
	const socketsByKey = new Map<string, PooledSocket[]>()

	let closed = false

	function removeEntry(entry: PooledSocket): void {
		const list = socketsByKey.get(entry.key)

		if (!list) {
			return
		}

		const filtered = list.filter(candidate => candidate.socket !== entry.socket)

		if (filtered.length === NO_ENTRIES) {
			socketsByKey.delete(entry.key)
			return
		}

		socketsByKey.set(entry.key, filtered)
	}

	function scheduleIdleDestroy(entry: PooledSocket): void {
		if (entry.idleTimer) {
			globalThis.clearTimeout(entry.idleTimer)
		}

		entry.idleTimer = globalThis.setTimeout(() => {
			removeEntry(entry)
			entry.socket.destroy()
		}, idleTimeoutMs)
	}

	async function createEntry(key: string, remotePublicKey: Buffer): Promise<PooledSocket> {
		const socket = node.connect(remotePublicKey, { keyPair })
		await awaitOpen(socket)

		const entry: PooledSocket = {
			busy: true,
			key,
			socket,
		}

		socket.once('close', () => {
			if (entry.idleTimer) {
				globalThis.clearTimeout(entry.idleTimer)
			}

			removeEntry(entry)
		})

		socket.once('error', () => {
			if (entry.idleTimer) {
				globalThis.clearTimeout(entry.idleTimer)
			}

			removeEntry(entry)
		})

		const list = socketsByKey.get(key) ?? []
		list.push(entry)
		socketsByKey.set(key, list)

		return entry
	}

	return {
		async acquire(remotePublicKey: Buffer): Promise<EncryptedSocket> {
			if (closed) {
				throw new Error('Peer pool is closed')
			}

			const key = remotePublicKey.toString('hex')
			const existing = (socketsByKey.get(key) ?? []).find(entry => !entry.busy)

			if (existing) {
				existing.busy = true

				if (existing.idleTimer) {
					globalThis.clearTimeout(existing.idleTimer)
					existing.idleTimer = undefined
				}

				return existing.socket
			}

			const entry = await createEntry(key, remotePublicKey)

			return entry.socket
		},

		async close(): Promise<void> {
			if (closed) {
				return
			}

			closed = true

			for (const list of socketsByKey.values()) {
				for (const entry of list) {
					if (entry.idleTimer) {
						globalThis.clearTimeout(entry.idleTimer)
					}
					entry.socket.destroy()
				}
			}

			socketsByKey.clear()
		},

		release(remotePublicKey: Buffer, socket: EncryptedSocket): void {
			if (closed) {
				socket.destroy()
				return
			}

			const key = remotePublicKey.toString('hex')
			const entry = (socketsByKey.get(key) ?? []).find(
				candidate => candidate.socket === socket,
			)

			if (!entry) {
				socket.destroy()
				return
			}

			entry.busy = false
			scheduleIdleDestroy(entry)
		},
	}
}
