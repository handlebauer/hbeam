/**
 * Unit tests for DHT key-derivation normalization behavior.
 *
 * Ensures passphrase-to-keypair derivation is runtime-stable and deterministic.
 *
 * @module
 */
import { test, expect } from 'bun:test'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { importFresh, withTempHome } from '@test/env.ts'
import * as b4a from 'b4a'
import DHT from 'hyperdht'

import { deriveKeyPair } from './dht.ts'
import { toBase32, fromBase32 } from './encoding.ts'

const KEY_SEED_BYTES = 32
const TEST_SEED_BYTE = 1

test('deriveKeyPair uses raw 32-byte base32 seed unchanged', () => {
	const seed = Buffer.alloc(KEY_SEED_BYTES, TEST_SEED_BYTE)
	const passphrase = toBase32(seed)

	const derived = deriveKeyPair(passphrase)
	const expected = DHT.keyPair(seed)

	expect(Buffer.from(derived.publicKey)).toEqual(Buffer.from(expected.publicKey))
})

test('deriveKeyPair normalizes non-32-byte base32 seeds to 32 bytes', () => {
	const passphrase = 'nodeledge'
	const decoded = fromBase32(passphrase)
	expect(decoded.length).not.toBe(KEY_SEED_BYTES)

	const normalized = b4a.from(createHash('sha256').update(decoded).digest())

	const derived = deriveKeyPair(passphrase)
	const expected = DHT.keyPair(normalized)

	expect(Buffer.from(derived.publicKey)).toEqual(Buffer.from(expected.publicKey))
})

type DhtModule = Readonly<{
	deriveKeyPair(passphrase: string): { publicKey: Buffer }
	resolveRemoteKey(target: string): Promise<Buffer>
}>

type AddressBookModule = Readonly<{
	addPeer(name: string, publicKeyHex: string): Promise<void>
}>

const PUBLIC_KEY_HEX_LENGTH = 64

test('resolveRemoteKey accepts raw 64-char hex keys', async () => {
	const module_ = await importFresh<DhtModule>(import.meta.dir, './dht.ts')
	const hex = 'a'.repeat(PUBLIC_KEY_HEX_LENGTH)
	const key = await module_.resolveRemoteKey(hex)
	expect(key.toString('hex')).toBe(hex)
})

test('resolveRemoteKey resolves saved peer names from address book', async () => {
	await withTempHome(async () => {
		const addressBook = await importFresh<AddressBookModule>(
			import.meta.dir,
			'./addressbook.ts',
		)
		const module_ = await importFresh<DhtModule>(import.meta.dir, './dht.ts')
		const hex = 'b'.repeat(PUBLIC_KEY_HEX_LENGTH)
		await addressBook.addPeer('work-peer', hex)

		const key = await module_.resolveRemoteKey('work-peer')
		expect(key.toString('hex')).toBe(hex)
	})
})

test('resolveRemoteKey falls back to passphrase-derived public key', async () => {
	const module_ = await importFresh<DhtModule>(import.meta.dir, './dht.ts')
	const passphrase = 'nodeledge'
	const expected = module_.deriveKeyPair(passphrase).publicKey
	const key = await module_.resolveRemoteKey(passphrase)
	expect(Buffer.from(key)).toEqual(Buffer.from(expected))
})
