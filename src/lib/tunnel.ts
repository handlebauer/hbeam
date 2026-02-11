/**
 * Reusable TCP-over-DHT tunnel primitives for bind-like commands.
 *
 * Provides reverse and forward proxy modes with connection lifecycle events.
 *
 * @module
 */
import { EventEmitter } from 'node:events'
import net from 'node:net'

import { awaitOpen, createNode } from './dht.ts'

import type {
	EncryptedSocket,
	ForwardTunnelOptions,
	HyperDHTNode,
	ReverseTunnelOptions,
	TunnelConnectionEvent,
	TunnelController,
	TunnelEventMap,
} from '../types.ts'

const DEFAULT_FORWARD_HOST = '127.0.0.1'

interface SocketWithRemotePublicKey {
	remotePublicKey?: Buffer
}

/**
 * Link two duplex sockets and destroy each side on counterpart errors.
 *
 * @param left - First socket.
 * @param right - Second socket.
 * @returns Nothing.
 */
function pipeBothWays(left: net.Socket, right: EncryptedSocket): void {
	left.pipe(right as unknown as NodeJS.WritableStream)
	;(right as unknown as NodeJS.ReadableStream).pipe(left)
}

/**
 * Best-effort extraction of a peer public key from HyperDHT sockets.
 *
 * @param socket - Encrypted P2P socket.
 * @returns Hex public key when available.
 */
function getRemotePublicKeyHex(socket: EncryptedSocket): string | undefined {
	const candidate = socket as unknown as SocketWithRemotePublicKey
	return candidate.remotePublicKey?.toString('hex')
}

/**
 * Create a reverse tunnel (P2P -> local TCP service).
 *
 * @param options - Reverse tunnel configuration.
 * @returns Controller for observing/closing the tunnel.
 */
export async function createReverseTunnel(
	options: ReverseTunnelOptions,
): Promise<TunnelController> {
	const events = new EventEmitter()
	const node = options.dht ?? createNode()
	const ownsNode = options.dht === undefined
	const server = node.createServer()

	let closed = false
	let connections = 0

	const peers = new Set<EncryptedSocket>()
	const tcpSockets = new Set<net.Socket>()

	function emitError(error: unknown): void {
		events.emit('error', error instanceof Error ? error : new Error(String(error)))
	}

	function onDisconnect(remotePublicKey?: string): void {
		connections--
		const payload: TunnelConnectionEvent = {
			activeConnections: connections,
			remotePublicKey,
		}
		events.emit('disconnect', payload)
	}

	server.on('error', emitError)

	server.on('connection', (peer: EncryptedSocket) => {
		if (closed) {
			peer.destroy()
			return
		}

		peers.add(peer)

		const local = net.connect({ host: options.host, port: options.port })
		tcpSockets.add(local)

		let connected = false
		let disconnected = false

		const remotePublicKey = getRemotePublicKeyHex(peer)

		function cleanup(): void {
			peers.delete(peer)
			tcpSockets.delete(local)

			if (connected && !disconnected) {
				disconnected = true
				onDisconnect(remotePublicKey)
			}
		}

		local.on('connect', () => {
			if (closed) {
				local.destroy()
				peer.destroy()
				return
			}

			connected = true
			connections++

			const payload: TunnelConnectionEvent = {
				activeConnections: connections,
				remotePublicKey,
			}
			events.emit('connect', payload)

			pipeBothWays(local, peer)
		})

		local.on('error', error => {
			emitError(error)
			peer.destroy()
		})

		local.on('close', cleanup)

		peer.on('error', error => {
			emitError(error)
			local.destroy()
		})

		peer.on('close', cleanup)
	})

	await server.listen(options.keyPair)

	const controller: TunnelController = {
		async close(): Promise<void> {
			if (closed) {
				return
			}

			closed = true

			for (const socket of tcpSockets) {
				socket.destroy()
			}

			for (const peer of peers) {
				peer.destroy()
			}

			await server.close().catch(() => {})

			if (ownsNode) {
				await node.destroy().catch(() => {})
			}
		},
		get connections(): number {
			return connections
		},
		on<K extends keyof TunnelEventMap>(event: K, handler: TunnelEventMap[K]): TunnelController {
			events.on(event, handler)
			return controller
		},
	}

	return controller
}

/**
 * Create a forward tunnel (local TCP listener -> P2P peer).
 *
 * @param options - Forward tunnel configuration.
 * @returns Controller for observing/closing the tunnel.
 */
export async function createForwardTunnel(
	options: ForwardTunnelOptions,
): Promise<TunnelController> {
	const events = new EventEmitter()
	const node: HyperDHTNode = options.dht ?? createNode()
	const ownsNode = options.dht === undefined
	const host = options.host ?? DEFAULT_FORWARD_HOST
	const tcpServer = net.createServer()

	let closed = false
	let connections = 0

	const peers = new Set<EncryptedSocket>()
	const tcpSockets = new Set<net.Socket>()

	function emitError(error: unknown): void {
		events.emit('error', error instanceof Error ? error : new Error(String(error)))
	}

	function onDisconnect(): void {
		connections--
		const payload: TunnelConnectionEvent = {
			activeConnections: connections,
			remotePublicKey: options.remotePublicKey.toString('hex'),
		}
		events.emit('disconnect', payload)
	}

	tcpServer.on('error', emitError)

	tcpServer.on('connection', (local: net.Socket) => {
		if (closed) {
			local.destroy()
			return
		}

		tcpSockets.add(local)
		local.pause()

		const peer = node.connect(options.remotePublicKey, { keyPair: options.keyPair })
		peers.add(peer)

		let connected = false
		let disconnected = false

		function cleanup(): void {
			tcpSockets.delete(local)
			peers.delete(peer)
			if (connected && !disconnected) {
				disconnected = true
				onDisconnect()
			}
		}

		void awaitOpen(peer)
			.then(() => {
				if (closed) {
					local.destroy()
					peer.destroy()
					return
				}

				connected = true
				connections++

				const payload: TunnelConnectionEvent = {
					activeConnections: connections,
					remotePublicKey: options.remotePublicKey.toString('hex'),
				}
				events.emit('connect', payload)
				local.resume()

				pipeBothWays(local, peer)
			})
			.catch(error => {
				emitError(error)

				local.destroy()
				peer.destroy()
			})

		local.on('error', error => {
			emitError(error)
			peer.destroy()
		})

		local.on('close', cleanup)

		peer.on('error', error => {
			emitError(error)
			local.destroy()
		})

		peer.on('close', cleanup)
	})

	await new Promise<void>((resolve, reject) => {
		tcpServer.listen(options.port, host, () => resolve())
		tcpServer.once('error', reject)
	})

	const controller: TunnelController = {
		async close(): Promise<void> {
			if (closed) {
				return
			}

			closed = true

			for (const socket of tcpSockets) {
				socket.destroy()
			}

			for (const peer of peers) {
				peer.destroy()
			}

			await new Promise<void>(resolve => {
				tcpServer.close(() => resolve())
			})

			if (ownsNode) {
				await node.destroy().catch(() => {})
			}
		},
		get connections(): number {
			return connections
		},
		get listenHost(): string {
			return host
		},
		get listenPort(): number | undefined {
			const address = tcpServer.address()

			return typeof address === 'object' && address ? address.port : undefined
		},
		on<K extends keyof TunnelEventMap>(event: K, handler: TunnelEventMap[K]): TunnelController {
			events.on(event, handler)

			return controller
		},
	}

	return controller
}
