/**
 * Core Beam duplex stream implementation built on HyperDHT sockets.
 *
 * Handles announce/connect setup, socket wiring, streamx lifecycle hooks,
 * and connection event emission for CLI and library consumers.
 *
 * @module
 */
import queueTick from 'queue-tick'
import { Duplex } from 'streamx'

import { awaitOpen, createFirewall, createNode, deriveKeyPair } from './lib/dht.ts'
import { randomBytes, toBase32 } from './lib/encoding.ts'

import type {
	BeamOptions,
	ConnectionInfo,
	EncryptedSocket,
	HyperDHTNode,
	HyperDHTServer,
	KeyPair,
	StreamCallback,
} from './types.ts'

/** Number of random bytes used to generate a passphrase seed. */
const KEY_SEED_BYTES = 32

/**
 * A 1-to-1 end-to-end encrypted duplex stream powered by HyperDHT.
 *
 * Creates an encrypted tunnel between two peers using a shared passphrase.
 * If no passphrase is provided, one is generated and the beam listens for
 * an incoming connection (server mode). When a passphrase is provided, the
 * beam connects to the listening peer (client mode).
 *
 * @example
 * ```ts
 * const server = new Beam()
 * console.log(server.key) // Share this with the other side
 *
 * const client = new Beam(server.key)
 * ```
 */
export class Beam extends Duplex {
	/** Base32-encoded passphrase for peer discovery and key derivation. */
	readonly key: string

	/** Whether this beam is announcing (server) or connecting (client). */
	readonly announce: boolean

	private node: HyperDHTNode | undefined
	private server: HyperDHTServer | undefined = undefined
	private inbound: EncryptedSocket | undefined = undefined
	private outbound: EncryptedSocket | undefined = undefined
	private readonly keyPairOverride: KeyPair | undefined
	private readonly remotePublicKeyOverride: Buffer | undefined
	private readonly openInboundFirewall: boolean

	private openCallback: StreamCallback | undefined = undefined
	private readCallback: StreamCallback | undefined = undefined
	private drainCallback: StreamCallback | undefined = undefined

	/**
	 * Create a new beam instance in announce or connect mode.
	 *
	 * @param keyOrOptions - Passphrase or options object.
	 * @param options - Options used when a passphrase is provided.
	 */
	constructor(keyOrOptions?: string | BeamOptions, options?: BeamOptions) {
		super()

		let key: string | undefined = undefined
		let opts: BeamOptions = {}
		const passphraseWasProvided = typeof keyOrOptions === 'string'

		if (passphraseWasProvided) {
			key = keyOrOptions
			opts = options ?? {}
		} else {
			opts = keyOrOptions ?? {}
		}

		let shouldAnnounce = opts.announce ?? false

		if (!key && !opts.keyPair) {
			key = toBase32(randomBytes(KEY_SEED_BYTES))
			shouldAnnounce = true
		} else if (!key && opts.keyPair) {
			key = opts.keyPair.publicKey.toString('hex')
		}
		if (!key) {
			throw new Error('Missing key material')
		}

		this.key = key
		this.announce = shouldAnnounce
		this.node = (opts.dht as HyperDHTNode) ?? undefined
		this.keyPairOverride = opts.keyPair
		this.remotePublicKeyOverride = opts.remotePublicKey
		this.openInboundFirewall = !passphraseWasProvided && opts.keyPair !== undefined
	}

	/**
	 * Whether a peer connection has been established.
	 *
	 * @returns True when outbound socket has been created.
	 */
	get connected(): boolean {
		return this.outbound !== undefined
	}

	// Streamx lifecycle

	/**
	 * Streamx open hook: initialize DHT node and start announce/connect flow.
	 *
	 * @param cb - Open callback from streamx.
	 * @returns Promise that resolves when setup path completes.
	 */
	override async _open(cb: StreamCallback): Promise<void> {
		this.openCallback = cb
		const keyPair = this.keyPairOverride ?? deriveKeyPair(this.key)
		this.node ??= createNode()

		if (this.announce) {
			await this.listenAsServer(keyPair)
		} else {
			await this.connectAsClient(keyPair)
		}
	}

	/**
	 * Streamx read hook: resume inbound flow when consumer requests data.
	 *
	 * @param cb - Read callback from streamx.
	 * @returns Nothing.
	 */
	override _read(cb: StreamCallback): void {
		this.readCallback = cb
		this.inbound?.resume()
	}

	/**
	 * Streamx write hook: write outbound bytes, respecting backpressure.
	 *
	 * @param data - Data chunk to send.
	 * @param cb - Write callback from streamx.
	 * @returns Nothing.
	 */
	override _write(data: unknown, cb: StreamCallback): void {
		if (this.outbound!.write(data as Buffer) !== false) {
			cb()
			return
		}
		this.drainCallback = cb
	}

	/**
	 * Streamx final hook: end outbound socket and resolve when flushed.
	 *
	 * @param cb - Final callback from streamx.
	 * @returns Nothing.
	 */
	override _final(cb: StreamCallback): void {
		/**
		 * Resolve the final callback once outbound finish/error fires.
		 *
		 * @returns Nothing.
		 */
		const done = (): void => {
			this.outbound!.removeListener('finish', done)
			this.outbound!.removeListener('error', done)
			cb()
		}
		this.outbound!.end()
		this.outbound!.on('finish', done)
		this.outbound!.on('error', done)
	}

	/**
	 * Streamx pre-destroy hook: tear down sockets and pending callbacks.
	 *
	 * @returns Nothing.
	 */
	override _predestroy(): void {
		this.inbound?.destroy()
		this.outbound?.destroy()
		const error = new Error('Destroyed')
		this.resolveOpen(error)
		this.resolveRead(error)
		this.resolveDrain(error)
	}

	/**
	 * Streamx destroy hook: close DHT server/node resources.
	 *
	 * @param cb - Destroy callback from streamx.
	 * @returns Promise that resolves after cleanup.
	 */
	override async _destroy(cb: StreamCallback): Promise<void> {
		if (!this.node) {
			cb()
			return
		}
		if (this.server) {
			await this.server.close().catch(() => {})
		}
		await this.node.destroy().catch(() => {})
		cb()
	}

	// Connection setup

	/**
	 * Start announce/listen mode with optional inbound firewall.
	 *
	 * @param keyPair - Local keypair used for server listen.
	 * @returns Promise that resolves when listen path completes.
	 */
	private async listenAsServer(keyPair: KeyPair): Promise<void> {
		const serverOptions = this.openInboundFirewall
			? undefined
			: { firewall: createFirewall(keyPair) }
		this.server = this.node!.createServer(serverOptions)
		this.server.on('connection', (socket: EncryptedSocket) => this.handleConnection(socket))

		try {
			await this.server.listen(keyPair)
		} catch (error) {
			this.resolveOpen(error as Error)
			return
		}
		this.emitRemoteAddress()
	}

	/**
	 * Start client mode by dialing a remote public key.
	 *
	 * @param keyPair - Local keypair used for dial auth.
	 * @returns Promise that resolves when connect path completes.
	 */
	private async connectAsClient(keyPair: KeyPair): Promise<void> {
		const remotePublicKey = this.remotePublicKeyOverride ?? keyPair.publicKey
		const socket: EncryptedSocket = this.node!.connect(remotePublicKey, { keyPair })

		try {
			await awaitOpen(socket)
		} catch (error) {
			this.resolveOpen(error as Error)
			return
		}
		this.emitRemoteAddress()
		this.handleConnection(socket)
	}

	/**
	 * Bind socket handlers for inbound/outbound stream integration.
	 *
	 * @param socket - Encrypted socket from HyperDHT.
	 * @returns Nothing.
	 */
	private handleConnection(socket: EncryptedSocket): void {
		socket.on('data', (data: Buffer) => {
			if (!this.inbound) {
				this.inbound = socket
				this.inbound.on('error', (err: Error) => this.destroy(err))
				this.inbound.on('end', () => this.pushEndOfStream())
			}
			if (socket !== this.inbound) {
				return
			}
			if (this.pushData(data) === false) {
				socket.pause()
			}
		})

		socket.on('end', () => {
			if (this.inbound) {
				return
			}
			this.pushEndOfStream()
		})

		if (!this.outbound) {
			this.outbound = socket
			this.outbound.on('error', (err: Error) => this.destroy(err))
			this.outbound.on('drain', () => this.resolveDrain())
			this.emit('connected')
			this.resolveOpen()
		}
	}

	// Helpers

	/**
	 * Push inbound data into streamx and schedule read callback resolution.
	 *
	 * @param data - Data chunk or end-of-stream marker.
	 * @returns Push backpressure result from streamx.
	 */
	private pushData(data: Buffer | null): boolean {
		const result = this.push(data)
		queueTick(() => this.resolveRead())
		return result
	}

	/**
	 * Push end-of-stream marker into streamx.
	 *
	 * @returns Nothing.
	 */
	private pushEndOfStream(): void {
		// oxlint-disable-next-line unicorn/no-null
		this.pushData(null)
	}

	/**
	 * Emit current node host/port information.
	 *
	 * @returns Nothing.
	 */
	private emitRemoteAddress(): void {
		this.emit('remote-address', {
			host: this.node!.host,
			port: this.node!.port,
		} satisfies ConnectionInfo)
	}

	/**
	 * Resolve the pending open callback, if any.
	 *
	 * @param error - Optional error to pass to callback.
	 * @returns Nothing.
	 */
	private resolveOpen(error?: Error): void {
		const cb = this.openCallback
		if (cb) {
			this.openCallback = undefined
			cb(error)
		}
	}

	/**
	 * Resolve the pending read callback, if any.
	 *
	 * @param error - Optional error to pass to callback.
	 * @returns Nothing.
	 */
	private resolveRead(error?: Error): void {
		const cb = this.readCallback
		if (cb) {
			this.readCallback = undefined
			cb(error)
		}
	}

	/**
	 * Resolve the pending drain callback, if any.
	 *
	 * @param error - Optional error to pass to callback.
	 * @returns Nothing.
	 */
	private resolveDrain(error?: Error): void {
		const cb = this.drainCallback
		if (cb) {
			this.drainCallback = undefined
			cb(error)
		}
	}
}
