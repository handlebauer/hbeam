/**
 * Options for constructing a {@link Beam} instance.
 */
export interface BeamOptions {
	/**
	 * Whether to announce (listen) on the DHT.
	 * Automatically set to `true` when no key is provided.
	 */
	announce?: boolean

	/**
	 * Explicit keypair to use for identity-based operation.
	 * When omitted, key material is derived from the passphrase.
	 */
	keyPair?: KeyPair

	/**
	 * Explicit remote public key to dial in identity-based client mode.
	 * When omitted, passphrase mode dials the derived public key.
	 */
	remotePublicKey?: Buffer

	/**
	 * An existing HyperDHT node to reuse.
	 * If omitted, an ephemeral node is created and destroyed with the beam.
	 */
	dht?: HyperDHTNode
}

/** A saved peer entry in the local address book. */
export interface Peer {
	addedAt: string
	publicKey: string
}

/** Name-keyed map of saved peers. */
export type AddressBook = Record<string, Peer>

/** Serialized identity persisted on disk. */
export interface Identity {
	publicKey: string
	secretKey: string
}

/**
 * Remote address information emitted via the `"remote-address"` event.
 */
export interface ConnectionInfo {
	/** Public-facing IP address of the DHT node. */
	host: string
	/** Port the DHT node is listening on. */
	port: number
}

/**
 * Callback type used by streamx Duplex stream internals.
 */
export type StreamCallback = (error?: Error) => void

// ---------------------------------------------------------------------------
// Typed shapes for external HyperDHT objects
// ---------------------------------------------------------------------------

/** A Noise keypair derived from a 32-byte seed. */
export interface KeyPair {
	publicKey: Buffer
	secretKey: Buffer
}

/** Minimal typed shape for a HyperDHT node (only what Beam uses). */
export interface HyperDHTNode {
	host: string
	port: number

	connect(remotePublicKey: Buffer, options?: { keyPair: KeyPair }): EncryptedSocket

	createServer(options?: { firewall?: (remotePublicKey: Buffer) => boolean }): HyperDHTServer

	destroy(): Promise<void>
}

/** A Noise-encrypted socket from HyperDHT. */
export interface EncryptedSocket {
	on(event: string, listener: (...args: any[]) => void): this
	once(event: string, listener: (...args: any[]) => void): this
	removeListener(event: string, listener: (...args: any[]) => void): this
	write(data: Buffer | Uint8Array): boolean
	end(): void
	pause(): void
	resume(): void
	destroy(): void
}

/** A HyperDHT server that listens for incoming encrypted connections. */
export interface HyperDHTServer {
	on(event: string, listener: (...args: any[]) => void): this
	listen(keyPair: KeyPair): Promise<void>
	close(): Promise<void>
}

/** Connection lifecycle events emitted by tunnel controllers. */
export interface TunnelEventMap {
	/** Emitted when a tunnel connection has been established. */
	connect: (event: TunnelConnectionEvent) => void
	/** Emitted when a tunnel connection has closed. */
	disconnect: (event: TunnelConnectionEvent) => void
	/** Emitted when a tunnel connection fails or a server-level error occurs. */
	error: (error: Error) => void
}

/** Metadata emitted with tunnel connection lifecycle events. */
export interface TunnelConnectionEvent {
	/** Number of currently active tunneled sockets. */
	activeConnections: number
	/** Remote P2P public key in hex when available. */
	remotePublicKey?: string
}

/** Common options used by forward/reverse tunnel constructors. */
export interface TunnelOptions {
	/** Local keypair used for DHT announce/connect authentication. */
	keyPair: KeyPair
	/** Optional existing DHT node to reuse. */
	dht?: HyperDHTNode
}

/** Options for creating a reverse tunnel (P2P -> local TCP service). */
export interface ReverseTunnelOptions extends TunnelOptions {
	/** Local TCP host receiving forwarded traffic. */
	host: string
	/** Local TCP port receiving forwarded traffic. */
	port: number
}

/** Options for creating a forward tunnel (local TCP -> P2P peer). */
export interface ForwardTunnelOptions extends TunnelOptions {
	/** Remote peer public key to dial over DHT. */
	remotePublicKey: Buffer
	/** Local TCP listen port for incoming client connections. */
	port: number
	/** Local TCP listen host. */
	host?: string
}

/** Runtime controller returned by tunnel constructors. */
export interface TunnelController {
	/** Current count of active proxied connections. */
	readonly connections: number
	/** Local TCP listen host when applicable (forward mode). */
	readonly listenHost?: string
	/** Local TCP listen port when applicable (forward mode). */
	readonly listenPort?: number
	/** Close all listeners/sockets and release resources. */
	close(): Promise<void>
	/** Subscribe to tunnel lifecycle events. */
	on<K extends keyof TunnelEventMap>(event: K, handler: TunnelEventMap[K]): this
}

/**
 * Event map documenting the events a Beam instance emits.
 *
 * Streamx does not enforce typed events at the type level, but this
 * serves as a reference for consumers.
 */
export interface BeamEvents {
	/** Emitted when a peer connection is fully established. */
	connected: () => void
	/** Emitted when the beam joins the DHT with address info. */
	'remote-address': (info: ConnectionInfo) => void
	/** Emitted when the stream encounters an error. */
	error: (error: Error) => void
	/** Emitted when the readable side ends. */
	end: () => void
	/** Emitted when the stream is fully closed. */
	close: () => void
}
