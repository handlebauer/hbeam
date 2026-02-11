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
