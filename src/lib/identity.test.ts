import { test, expect } from 'bun:test'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { withTempHome, importFresh } from '@test/env.ts'

import type { KeyPair } from '../types.ts'

type IdentityModule = Readonly<{
	getPublicKeyHex(): Promise<string>
	loadOrCreateIdentityWithMeta(): Promise<{ created: boolean; keyPair: KeyPair }>
}>

const CONFIG_DIR = '.config'
const APP_DIR = 'hbeam'
const IDENTITY_FILE = 'identity.json'
const FILE_MODE_MASK = 0o777
const SECURE_MODE = 0o600
const PUBLIC_KEY_HEX_LENGTH = 64

test('loadOrCreateIdentityWithMeta creates once and then reuses', async () => {
	await withTempHome(async ({ homeDir }) => {
		const module_ = await importFresh<IdentityModule>(import.meta.dir, './identity.ts')

		const first = await module_.loadOrCreateIdentityWithMeta()
		expect(first.created).toBe(true)

		const second = await module_.loadOrCreateIdentityWithMeta()
		expect(second.created).toBe(false)
		expect(Buffer.from(second.keyPair.publicKey)).toEqual(Buffer.from(first.keyPair.publicKey))
		expect(Buffer.from(second.keyPair.secretKey)).toEqual(Buffer.from(first.keyPair.secretKey))

		const publicKeyHex = await module_.getPublicKeyHex()
		expect(publicKeyHex).toBe(first.keyPair.publicKey.toString('hex'))
		expect(publicKeyHex).toHaveLength(PUBLIC_KEY_HEX_LENGTH)

		const identityPath = join(homeDir, CONFIG_DIR, APP_DIR, IDENTITY_FILE)
		const identityStats = await stat(identityPath)
		expect(identityStats.mode & FILE_MODE_MASK).toBe(SECURE_MODE)
	})
})
