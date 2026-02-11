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

function asHex(buffer: Buffer): string {
	return buffer.toString('hex')
}

function fromHex(hex: string): Buffer {
	return Buffer.from(hex, 'hex')
}

function isHex(value: string): boolean {
	return /^[0-9a-f]+$/i.test(value) && value.length % MODULUS_EVEN === REMAINDER_ZERO
}

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

function serializeIdentity(keyPair: KeyPair): Identity {
	return {
		publicKey: asHex(keyPair.publicKey),
		secretKey: asHex(keyPair.secretKey),
	}
}

function createIdentity(): KeyPair {
	return DHT.keyPair(randomBytes(KEY_SEED_BYTES))
}

/** Load a persisted identity if present; otherwise create and persist one. */
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

/** Load or create the local hbeam identity keypair. */
export async function loadOrCreateIdentity(): Promise<KeyPair> {
	const { keyPair } = await loadOrCreateIdentityWithMeta()
	return keyPair
}

/** Return the public key hex string for the local identity. */
export async function getPublicKeyHex(): Promise<string> {
	const keyPair = await loadOrCreateIdentity()
	return asHex(keyPair.publicKey)
}
