import { test, expect } from 'bun:test'

import { withTempHome, importFresh } from '@test/env.ts'

import type { Peer } from '../types.ts'

type AddressBookModule = Readonly<{
	addPeer(name: string, publicKeyHex: string): Promise<Peer>
	getPeer(name: string): Promise<Peer | undefined>
	listPeers(): Promise<({ name: string } & Peer)[]>
	removePeer(name: string): Promise<boolean>
}>

const PUBLIC_KEY_HEX_LENGTH = 64
const VALID_PUBLIC_KEY = 'a'.repeat(PUBLIC_KEY_HEX_LENGTH)
const INVALID_PUBLIC_KEY = 'zz'
const BAD_NAME = 'bad name'
const PEER_NAME = 'Work-Server'
const NORMALIZED_PEER_NAME = 'work-server'
const EXPECTED_ENTRY_COUNT = 1
const EXPECTED_EMPTY_COUNT = 0

test('address book supports add/get/list/remove lifecycle', async () => {
	await withTempHome(async () => {
		const module_ = await importFresh<AddressBookModule>(import.meta.dir, './addressbook.ts')

		await module_.addPeer(PEER_NAME, VALID_PUBLIC_KEY)

		const saved = await module_.getPeer(NORMALIZED_PEER_NAME)
		expect(saved?.publicKey).toBe(VALID_PUBLIC_KEY)
		expect(typeof saved?.addedAt).toBe('string')

		const peers = await module_.listPeers()
		expect(peers).toHaveLength(EXPECTED_ENTRY_COUNT)
		expect(peers[EXPECTED_EMPTY_COUNT]?.name).toBe(NORMALIZED_PEER_NAME)

		const removed = await module_.removePeer(PEER_NAME)
		expect(removed).toBe(true)
		expect(await module_.getPeer(PEER_NAME)).toBeUndefined()

		const peersAfterRemove = await module_.listPeers()
		expect(peersAfterRemove).toHaveLength(EXPECTED_EMPTY_COUNT)
	})
})

test('address book validates peer names and public keys', async () => {
	await withTempHome(async () => {
		const module_ = await importFresh<AddressBookModule>(import.meta.dir, './addressbook.ts')

		await expect(module_.addPeer(BAD_NAME, VALID_PUBLIC_KEY)).rejects.toThrow(
			'Peer name must use only letters, numbers, and hyphens',
		)
		await expect(module_.addPeer(PEER_NAME, INVALID_PUBLIC_KEY)).rejects.toThrow(
			'Public key must be a valid hex string',
		)
	})
})
