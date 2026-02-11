/**
 * Unit tests for tunnel controllers.
 *
 * Verifies startup/teardown behavior for reverse and forward tunnel helpers.
 *
 * @module
 */
import { expect, test } from 'bun:test'

import { createForwardTunnel, createReverseTunnel } from './tunnel.ts'

import type { EncryptedSocket, HyperDHTNode, HyperDHTServer, KeyPair } from '../types.ts'

const PUBLIC_KEY_FILL = 1
const SECRET_KEY_FILL = 2
const PUBLIC_KEY_BYTES = 32
const SECRET_KEY_BYTES = 64
const RANDOM_PORT = 0
const ZERO = 0
const MIN_BOUND_PORT = 1

type Listener = (...args: unknown[]) => void

class FakeServer implements HyperDHTServer {
	public readonly listeners = new Map<string, Listener[]>()
	public closed = false
	public listenedWith: KeyPair | undefined = undefined

	on(event: string, listener: (...args: any[]) => void): this {
		const existing = this.listeners.get(event) ?? []
		existing.push(listener)
		this.listeners.set(event, existing)
		return this
	}

	async listen(keyPair: KeyPair): Promise<void> {
		this.listenedWith = keyPair
	}

	async close(): Promise<void> {
		this.closed = true
	}
}

function createFakeKeyPair(): KeyPair {
	return {
		publicKey: Buffer.alloc(PUBLIC_KEY_BYTES, PUBLIC_KEY_FILL),
		secretKey: Buffer.alloc(SECRET_KEY_BYTES, SECRET_KEY_FILL),
	}
}

test('createReverseTunnel listens on provided DHT server and closes cleanly', async () => {
	const fakeServer = new FakeServer()
	let destroyCalls = 0
	const fakeNode: HyperDHTNode = {
		connect(): EncryptedSocket {
			throw new Error('not used in reverse tunnel test')
		},
		createServer(): HyperDHTServer {
			return fakeServer
		},
		destroy: async (): Promise<void> => {
			destroyCalls++
		},
		host: '127.0.0.1',
		port: 1234,
	}

	const keyPair = createFakeKeyPair()
	const tunnel = await createReverseTunnel({
		dht: fakeNode,
		host: 'localhost',
		keyPair,
		port: 3000,
	})

	expect(fakeServer.listenedWith).toEqual(keyPair)
	await tunnel.close()
	expect(fakeServer.closed).toBe(true)
	expect(destroyCalls).toBe(ZERO)
})

test('createForwardTunnel binds local listener and exposes listen port', async () => {
	let destroyCalls = 0
	const fakeNode: HyperDHTNode = {
		connect(): EncryptedSocket {
			throw new Error('not used in forward tunnel test')
		},
		createServer(): HyperDHTServer {
			throw new Error('not used in forward tunnel test')
		},
		destroy: async (): Promise<void> => {
			destroyCalls++
		},
		host: '127.0.0.1',
		port: 4321,
	}

	const tunnel = await createForwardTunnel({
		dht: fakeNode,
		keyPair: createFakeKeyPair(),
		port: RANDOM_PORT,
		remotePublicKey: Buffer.alloc(PUBLIC_KEY_BYTES, PUBLIC_KEY_FILL),
	})

	expect(typeof tunnel.listenPort).toBe('number')
	expect((tunnel.listenPort ?? ZERO) >= MIN_BOUND_PORT).toBe(true)

	await tunnel.close()
	await tunnel.close()
	expect(destroyCalls).toBe(ZERO)
})
