/**
 * Reusable TCP-over-DHT tunnel primitives for expose and connect commands.
 *
 * Provides reverse and forward proxy modes with connection lifecycle events,
 * plus shared runtime helpers (shutdown, error classification, key display).
 *
 * @module
 */
import { EventEmitter } from 'node:events'
import net from 'node:net'

import { awaitOpen, createNode } from './dht.ts'
import {
	blank,
	clearLine,
	dim,
	endInline,
	log,
	logError,
	type Spinner,
	writeInline,
} from './log.ts'

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
const EXIT_FAILURE = 1
const EXIT_SUCCESS = 0
const FIRST_ACTIVE_CONNECTION = 1
const NO_ACTIVE_CONNECTIONS = 0
const KEY_PREFIX_START = 0
const SHORT_KEY_PREFIX = 12

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
 * Render a short public-key hint for status lines.
 *
 * @param publicKey - Hex public key.
 * @returns Short key preview.
 */
export function shortenKey(publicKey: string): string {
	if (publicKey.length <= SHORT_KEY_PREFIX) {
		return publicKey
	}

	return `${publicKey.slice(KEY_PREFIX_START, SHORT_KEY_PREFIX)}...`
}

/**
 * Determine whether a tunnel error is a non-fatal per-connection close.
 *
 * @param error - Error emitted by tunnel internals.
 * @returns True when tunnel should continue running.
 */
export function isBenignConnectionError(error: Error): boolean {
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
 * Register SIGINT/SIGTERM handlers and bind tunnel lifecycle events to UI output.
 *
 * @param tunnel - Active tunnel controller.
 * @param spinner - Active spinner instance.
 * @returns Nothing.
 */
export function registerShutdown(tunnel: TunnelController, spinner: Spinner): void {
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
