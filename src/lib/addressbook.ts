import { readJsonFile, writeJsonFile } from './config.ts'

import type { AddressBook, Peer } from '../types.ts'

const PEERS_FILE = 'peers.json'
const MODULUS_EVEN = 2
const PUBLIC_KEY_BYTES = 32
const REMAINDER_ZERO = 0

function isHex(value: string): boolean {
	return /^[0-9a-f]+$/i.test(value) && value.length % MODULUS_EVEN === REMAINDER_ZERO
}

function normalizePublicKeyHex(publicKeyHex: string): string {
	const normalized = publicKeyHex.trim().toLowerCase()
	if (!isHex(normalized)) {
		throw new Error('Public key must be a valid hex string')
	}
	const key = Buffer.from(normalized, 'hex')
	if (key.length !== PUBLIC_KEY_BYTES) {
		throw new Error('Public key must be 32 bytes (64 hex chars)')
	}
	return normalized
}

function normalizePeerName(name: string): string {
	const normalized = name.trim().toLowerCase()
	if (!/^[a-z0-9-]+$/.test(normalized)) {
		throw new Error('Peer name must use only letters, numbers, and hyphens')
	}
	return normalized
}

async function readAddressBook(): Promise<AddressBook> {
	return (await readJsonFile<AddressBook>(PEERS_FILE)) ?? {}
}

async function writeAddressBook(addressBook: AddressBook): Promise<void> {
	await writeJsonFile(PEERS_FILE, addressBook)
}

/** Add or update a named peer in the local address book. */
export async function addPeer(name: string, publicKeyHex: string): Promise<Peer> {
	const normalizedName = normalizePeerName(name)
	const normalizedPublicKey = normalizePublicKeyHex(publicKeyHex)
	const addressBook = await readAddressBook()

	const peer: Peer = {
		addedAt: new Date().toISOString(),
		publicKey: normalizedPublicKey,
	}
	addressBook[normalizedName] = peer

	await writeAddressBook(addressBook)
	return peer
}

/** Remove a peer from the local address book. */
export async function removePeer(name: string): Promise<boolean> {
	const normalizedName = normalizePeerName(name)
	const addressBook = await readAddressBook()
	if (!addressBook[normalizedName]) {
		return false
	}
	delete addressBook[normalizedName]
	await writeAddressBook(addressBook)
	return true
}

/** Return all peers sorted by name. */
export async function listPeers(): Promise<({ name: string } & Peer)[]> {
	const addressBook = await readAddressBook()
	return Object.entries(addressBook)
		.map(([name, peer]) => ({ name, ...peer }))
		.toSorted((a, b) => a.name.localeCompare(b.name))
}

/** Lookup a single peer by name. */
export async function getPeer(name: string): Promise<Peer | undefined> {
	const normalizedName = normalizePeerName(name)
	const addressBook = await readAddressBook()
	return addressBook[normalizedName]
}
