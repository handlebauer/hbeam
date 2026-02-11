import { test, expect } from 'bun:test'

import { Beam } from './beam.ts'

import type { KeyPair } from './types.ts'

const PUBLIC_KEY_BYTES = 32
const SECRET_KEY_BYTES = 64
const SECRET_FILL = 1
const MINIMUM_GENERATED_KEY_LENGTH = 1

function createFakeKeyPair(): KeyPair {
	return {
		publicKey: Buffer.alloc(PUBLIC_KEY_BYTES),
		secretKey: Buffer.alloc(SECRET_KEY_BYTES, SECRET_FILL),
	}
}

test('beam uses identity keypair public key as key display value', () => {
	const keyPair = createFakeKeyPair()
	const beam = new Beam({
		announce: true,
		keyPair,
	})

	expect(beam.announce).toBe(true)
	expect(beam.key).toBe(keyPair.publicKey.toString('hex'))
})

test('beam without passphrase still auto-announces with generated key', () => {
	const beam = new Beam()

	expect(beam.announce).toBe(true)
	expect(beam.key.length).toBeGreaterThanOrEqual(MINIMUM_GENERATED_KEY_LENGTH)
})
