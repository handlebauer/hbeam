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
