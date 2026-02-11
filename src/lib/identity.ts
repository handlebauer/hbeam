/**
 * Persistent identity keypair management for hbeam.
 *
 * Loads, validates, creates, and serializes identity key material stored
 * under the local config directory.
 *
 * @module
 */
import DHT from 'hyperdht'

import { readJsonFile, writeJsonFile } from './config.ts'
import { randomBytes } from './encoding.ts'

import type { Identity, KeyPair } from '../types.ts'

const IDENTITY_FILE = 'identity.json'

const MODULUS_EVEN = 2
const REMAINDER_ZERO = 0
const PUBLIC_KEY_BYTES = 32
const KEY_SEED_BYTES = 32
const SECRET_KEY_BYTES = 64

/**
 * Convert a key buffer to a hex string.
 *
 * @param buffer - Key bytes.
 * @returns Lowercase hex representation.
 */
function asHex(buffer: Buffer): string {
	return buffer.toString('hex')
}

/**
 * Parse a hex string into a key buffer.
 *
 * @param hex - Hex-encoded bytes.
 * @returns Buffer decoded from hex.
 */
function fromHex(hex: string): Buffer {
	return Buffer.from(hex, 'hex')
}

/**
 * Check whether a string is valid even-length hex.
 *
 * @param value - Candidate hex string.
 * @returns True when string is valid hex.
 */
function isHex(value: string): boolean {
	return /^[0-9a-f]+$/i.test(value) && value.length % MODULUS_EVEN === REMAINDER_ZERO
}

/**
 * Validate and parse serialized identity data.
 *
 * @param value - Serialized identity object from disk.
 * @returns Keypair parsed from identity object.
 */
function parseIdentity(value: Identity): KeyPair {
	if (!isHex(value.publicKey) || !isHex(value.secretKey)) {
		throw new Error('Invalid identity file: keys must be hex-encoded')
	}

	const publicKey = fromHex(value.publicKey)
	const secretKey = fromHex(value.secretKey)

	if (publicKey.length !== PUBLIC_KEY_BYTES || secretKey.length !== SECRET_KEY_BYTES) {
		throw new Error('Invalid identity file: unexpected key lengths')
	}

	return { publicKey, secretKey }
}

/**
 * Serialize a keypair for disk storage.
 *
 * @param keyPair - Keypair to serialize.
 * @returns Identity object with hex-encoded keys.
 */
function serializeIdentity(keyPair: KeyPair): Identity {
	return {
		publicKey: asHex(keyPair.publicKey),
		secretKey: asHex(keyPair.secretKey),
	}
}

/**
 * Create a brand new identity keypair.
 *
 * @returns Freshly generated keypair.
 */
function createIdentity(): KeyPair {
	return DHT.keyPair(randomBytes(KEY_SEED_BYTES))
}

/**
 * Load a persisted identity if present; otherwise create and persist one.
 *
 * @returns Keypair and metadata indicating whether it was newly created.
 */
export async function loadOrCreateIdentityWithMeta(): Promise<{
	created: boolean
	keyPair: KeyPair
}> {
	const existing = await readJsonFile<Identity>(IDENTITY_FILE)
	if (existing) {
		return { created: false, keyPair: parseIdentity(existing) }
	}

	const keyPair = createIdentity()
	await writeJsonFile(IDENTITY_FILE, serializeIdentity(keyPair), { secure: true })
	return { created: true, keyPair }
}

/**
 * Load or create the local hbeam identity keypair.
 *
 * @returns Local identity keypair.
 */
export async function loadOrCreateIdentity(): Promise<KeyPair> {
	const { keyPair } = await loadOrCreateIdentityWithMeta()
	return keyPair
}

/**
 * Return the public key hex string for the local identity.
 *
 * @returns Hex-encoded public key.
 */
export async function getPublicKeyHex(): Promise<string> {
	const keyPair = await loadOrCreateIdentity()
	return asHex(keyPair.publicKey)
}
