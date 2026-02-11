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

	/** Whether a peer connection has been established. */
	get connected(): boolean {
		return this.outbound !== undefined
	}

	// Streamx lifecycle

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

	override _read(cb: StreamCallback): void {
		this.readCallback = cb
		this.inbound?.resume()
	}

	override _write(data: unknown, cb: StreamCallback): void {
		if (this.outbound!.write(data as Buffer) !== false) {
			cb()
			return
		}
		this.drainCallback = cb
	}

	override _final(cb: StreamCallback): void {
		const done = (): void => {
			this.outbound!.removeListener('finish', done)
			this.outbound!.removeListener('error', done)
			cb()
		}
		this.outbound!.end()
		this.outbound!.on('finish', done)
		this.outbound!.on('error', done)
	}

	override _predestroy(): void {
		this.inbound?.destroy()
		this.outbound?.destroy()
		const error = new Error('Destroyed')
		this.resolveOpen(error)
		this.resolveRead(error)
		this.resolveDrain(error)
	}

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

	private pushData(data: Buffer | null): boolean {
		const result = this.push(data)
		queueTick(() => this.resolveRead())
		return result
	}

	private pushEndOfStream(): void {
		// oxlint-disable-next-line unicorn/no-null
		this.pushData(null)
	}

	private emitRemoteAddress(): void {
		this.emit('remote-address', {
			host: this.node!.host,
			port: this.node!.port,
		} satisfies ConnectionInfo)
	}

	private resolveOpen(error?: Error): void {
		const cb = this.openCallback
		if (cb) {
			this.openCallback = undefined
			cb(error)
		}
	}

	private resolveRead(error?: Error): void {
		const cb = this.readCallback
		if (cb) {
			this.readCallback = undefined
			cb(error)
		}
	}

	private resolveDrain(error?: Error): void {
		const cb = this.drainCallback
		if (cb) {
			this.drainCallback = undefined
			cb(error)
		}
	}
}
