/**
 * `hbeam gateway` command implementation.
 *
 * Starts a local HTTP gateway and routes requests by subdomain to remote
 * peers over encrypted HyperDHT sockets.
 *
 * @module
 */
import http from 'node:http'

import { copyToClipboard } from '@/lib/clipboard.ts'
import { createNode, deriveKeyPair, parsePort, resolveRemoteKey } from '@/lib/dht.ts'
import { randomBytes, toBase32 } from '@/lib/encoding.ts'
import { LOOPBACK_HOST, parsePeerTarget, renderGatewayStatusHtml } from '@/lib/gateway.ts'
import { loadOrCreateIdentityWithMeta } from '@/lib/identity.ts'
import {
	blank,
	clearLine,
	createSpinner,
	cyan,
	dim,
	gray,
	log,
	logError,
	write,
} from '@/lib/log.ts'
import { createPulseFrames } from '@/lib/pulse.ts'
import { createForwardTunnel, isBenignConnectionError } from '@/lib/tunnel.ts'

import type { HyperDHTNode, KeyPair, TunnelController } from '@/types.ts'

const EXIT_FAILURE = 1
const EXIT_SUCCESS = 0
const DEFAULT_GATEWAY_PORT = 0
const EPHEMERAL_KEY_BYTES = 32
const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404
const HTTP_BAD_GATEWAY = 502
const PUBLIC_KEY_HEX_BYTES = 32
const NO_ARGS = 0
const RANDOM_PORT = 0
const IDLE_EVICT_MS = 60_000

interface TunnelEndpoint {
	controller: TunnelController
	idleTimer?: ReturnType<typeof globalThis.setTimeout>
	port: number
}

interface GatewayCommandOptions {
	port?: number | string
	temp?: boolean
}

interface TunnelEndpointPool {
	acquire(remotePublicKey: Buffer): Promise<number>
	close(): Promise<void>
	release(remotePublicKey: Buffer): void
}

/**
 * Print a gateway usage error and terminate with failure.
 *
 * @param message - Error message to display.
 * @returns Never returns (process exits).
 */
function showUsageError(message: string): never {
	blank()
	logError(message)
	write(dim('Usage: hbeam gateway [-p <port>] [--temp]'))
	blank()
	process.exit(EXIT_FAILURE)
}

/**
 * Create a cache of per-peer local forward tunnel endpoints.
 *
 * Endpoints are created on demand and evicted after an idle timeout.
 *
 * @param node - Shared HyperDHT node.
 * @param keyPair - Local identity keypair.
 * @returns Endpoint pool lifecycle.
 */
function createTunnelEndpointPool(node: HyperDHTNode, keyPair: KeyPair): TunnelEndpointPool {
	const endpoints = new Map<string, TunnelEndpoint>()
	let closed = false

	function clearIdleTimer(endpoint: TunnelEndpoint): void {
		if (endpoint.idleTimer) {
			globalThis.clearTimeout(endpoint.idleTimer)
			endpoint.idleTimer = undefined
		}
	}

	return {
		async acquire(remotePublicKey: Buffer): Promise<number> {
			if (closed) {
				throw new Error('Gateway tunnel pool is closed')
			}

			const key = remotePublicKey.toString('hex')
			const existing = endpoints.get(key)

			if (existing) {
				clearIdleTimer(existing)
				return existing.port
			}

			const controller = await createForwardTunnel({
				dht: node,
				host: LOOPBACK_HOST,
				keyPair,
				port: RANDOM_PORT,
				remotePublicKey,
			})

			const port = controller.listenPort

			if (port === undefined) {
				await controller.close().catch(() => {})
				throw new Error('Failed to allocate local tunnel endpoint')
			}

			controller.on('error', (error: Error) => {
				if (isBenignConnectionError(error)) {
					return
				}

				logError(error.message)
				endpoints.delete(key)
				void controller.close().catch(() => {})
			})

			endpoints.set(key, { controller, port })

			return port
		},

		async close(): Promise<void> {
			if (closed) {
				return
			}

			closed = true

			for (const endpoint of endpoints.values()) {
				clearIdleTimer(endpoint)
				await endpoint.controller.close().catch(() => {})
			}

			endpoints.clear()
		},

		release(remotePublicKey: Buffer): void {
			if (closed) {
				return
			}

			const key = remotePublicKey.toString('hex')
			const endpoint = endpoints.get(key)

			if (!endpoint) {
				return
			}

			clearIdleTimer(endpoint)

			endpoint.idleTimer = globalThis.setTimeout(() => {
				endpoints.delete(key)
				void endpoint.controller.close().catch(() => {})
			}, IDLE_EVICT_MS)
		},
	}
}

/**
 * Execute `hbeam gateway`.
 *
 * @param argv - Positional command arguments after `gateway`.
 * @param options - Optional command flags.
 * @returns Promise that resolves when command setup completes.
 */
export async function runGatewayCommand(
	argv: string[],
	options: GatewayCommandOptions = {},
): Promise<void> {
	if (argv.length > NO_ARGS) {
		showUsageError('Unexpected positional arguments.')
	}

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
		showUsageError('Failed to initialize gateway identity.')
	}

	let listenPort = DEFAULT_GATEWAY_PORT

	try {
		listenPort = options.port ? parsePort(options.port, 'gateway port') : DEFAULT_GATEWAY_PORT
	} catch (error) {
		showUsageError((error as Error).message)
	}

	const node = createNode()
	const endpointPool = createTunnelEndpointPool(node, keyPair)
	const { frames, intervalMs } = createPulseFrames('HBEAM')
	const spinner = createSpinner(frames, intervalMs)

	const server = http.createServer((req, res) => {
		const target = parsePeerTarget(req.headers.host)

		if (!target) {
			const address = server.address()
			const port =
				typeof address === 'object' && address && typeof address.port === 'number'
					? address.port
					: DEFAULT_GATEWAY_PORT

			res.writeHead(HTTP_OK, { 'content-type': 'text/html; charset=utf-8' })
			res.end(renderGatewayStatusHtml(port))

			return
		}

		void (async (): Promise<void> => {
			let remotePublicKey: Buffer | undefined = undefined

			try {
				remotePublicKey = await resolveRemoteKey(target)
			} catch (error) {
				res.writeHead(HTTP_NOT_FOUND, { 'content-type': 'text/plain; charset=utf-8' })
				res.end(`Unknown peer target: ${target}\n\n${String(error)}`)

				return
			}

			if (remotePublicKey.length !== PUBLIC_KEY_HEX_BYTES) {
				res.writeHead(HTTP_BAD_REQUEST, { 'content-type': 'text/plain; charset=utf-8' })
				res.end(`Invalid peer target: ${target}`)

				return
			}

			const remoteKey = remotePublicKey
			const localPort = await endpointPool.acquire(remoteKey)

			let released = false

			function releaseEndpoint(): void {
				if (released) {
					return
				}

				released = true
				endpointPool.release(remoteKey)
			}

			const proxyReq = http.request(
				{
					agent: false,
					headers: { ...req.headers },
					host: LOOPBACK_HOST,
					method: req.method,
					path: req.url ?? '/',
					port: String(localPort),
				},
				proxyRes => {
					res.writeHead(proxyRes.statusCode ?? HTTP_BAD_GATEWAY, proxyRes.headers)
					proxyRes.pipe(res)
					proxyRes.once('close', releaseEndpoint)
					proxyRes.once('end', releaseEndpoint)
					proxyRes.once('error', releaseEndpoint)
				},
			)

			proxyReq.once('error', error => {
				if (!res.headersSent) {
					res.writeHead(HTTP_BAD_GATEWAY, { 'content-type': 'text/plain; charset=utf-8' })
					res.end(`Failed to route request\n\n${error.message}`)
				}

				releaseEndpoint()
			})

			req.once('aborted', () => {
				releaseEndpoint()
			})
			res.once('close', releaseEndpoint)

			req.pipe(proxyReq)
		})()
	})

	server.on('error', (error: Error) => {
		spinner.stop()
		logError(error.message)
	})

	async function shutdown(exitCode: number): Promise<void> {
		spinner.stop()

		blank()
		log(dim('SHUTTING DOWN'))
		blank()

		server.close()

		await endpointPool.close().catch(() => {})
		await node.destroy().catch(() => {})

		process.exit(exitCode)
	}

	process.once('SIGINT', () => {
		clearLine()
		void shutdown(EXIT_SUCCESS)
	})
	process.once('SIGTERM', () => void shutdown(EXIT_SUCCESS))

	blank()
	spinner.start()
	spinner.blank()
	spinner.write(dim('ANNOUNCING'))
	spinner.write(cyan(announceValue))

	await new Promise<void>((resolve, reject) => {
		server.listen(listenPort, LOOPBACK_HOST, () => resolve())
		server.once('error', reject)
	})

	const address = server.address()
	const actualPort = typeof address === 'object' && address ? address.port : listenPort

	if (node.host && node.port > RANDOM_PORT) {
		spinner.write(dim(`ONLINE ${gray(`[${node.host}:${node.port}]`)}`))
		spinner.blank()
	}

	spinner.write(`LISTENING ${dim(`${LOOPBACK_HOST}:${actualPort}`)}`)
	spinner.blank()
}
