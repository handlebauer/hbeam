/**
 * Ambient module declarations for untyped Hyperswarm ecosystem packages.
 *
 * These provide just enough type information for our imports to type-check.
 * See src/types.ts for the richer interfaces we use internally.
 */

declare module 'streamx' {
	export class Duplex {
		writable: boolean
		push(data: unknown): boolean
		write(...args: any[]): boolean
		destroy(err?: Error): void
		emit(event: string, ...args: unknown[]): boolean
		addListener(event: string, listener: (...args: any[]) => void): this
		eventNames(): (string | symbol)[]
		getMaxListeners(): number
		listenerCount(eventName: string | symbol): number
		listeners(eventName: string | symbol): ((...args: any[]) => void)[]
		on(event: string, listener: (...args: any[]) => void): this
		off(event: string, listener: (...args: any[]) => void): this
		once(event: string, listener: (...args: any[]) => void): this
		prependListener(event: string, listener: (...args: any[]) => void): this
		prependOnceListener(event: string, listener: (...args: any[]) => void): this
		rawListeners(eventName: string | symbol): ((...args: any[]) => void)[]
		removeAllListeners(event?: string | symbol): this
		removeListener(event: string, listener: (...args: any[]) => void): this
		setMaxListeners(n: number): this
		end(...args: any[]): this
		pipe<T>(dest: T): T

		_open(cb: (err?: Error) => void): void
		_read(cb: (err?: Error) => void): void
		_write(data: unknown, cb: (err?: Error) => void): void
		_final(cb: (err?: Error) => void): void
		_predestroy(): void
		_destroy(cb: (err?: Error) => void): void
	}
}

declare module 'hyperdht' {
	class DHT {
		constructor(options?: { ephemeral?: boolean })
		static keyPair(seed: Buffer): { publicKey: Buffer; secretKey: Buffer }

		host: string
		port: number

		connect(
			remotePublicKey: Buffer,
			options?: { keyPair: { publicKey: Buffer; secretKey: Buffer } },
		): any

		createServer(options?: { firewall?: (remotePublicKey: Buffer) => boolean }): any

		destroy(): Promise<void>
	}

	export default DHT
}

declare module 'sodium-universal' {
	const sodium: {
		randombytes_buf(buffer: Buffer): void
	}
	export default sodium
}

declare module 'b4a' {
	export function alloc(size: number): Buffer
	export function from(data: unknown): Buffer
	export function equals(a: Buffer, b: Buffer): boolean
}

declare module 'hi-base32' {
	const b32: {
		encode(buffer: Buffer | Uint8Array): string
		decode: {
			asBytes(str: string): number[]
		}
	}
	export default b32
}

declare module 'queue-tick' {
	export default function queueTick(fn: () => void): void
}
