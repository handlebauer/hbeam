import { addPeer, getPeer, listPeers, removePeer } from '@/lib/addressbook.ts'
import { blank, bold, cyan, dim, log, logError, write } from '@/lib/log.ts'
import { confirm } from '@/lib/prompt.ts'

const EXIT_SUCCESS = 0
const EXIT_FAILURE = 1
const START_INDEX = 0
const PUBLIC_KEY_PREFIX_LENGTH = 8
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY
const SECONDS_PER_WEEK = SECONDS_PER_DAY * DAYS_PER_WEEK
const EMPTY_PEERS = 0

function formatAge(addedAt: string): string {
	const then = Date.parse(addedAt)

	if (Number.isNaN(then)) {
		return 'unknown'
	}

	const seconds = Math.floor((Date.now() - then) / MILLISECONDS_PER_SECOND)

	if (seconds < SECONDS_PER_MINUTE) {
		return 'just now'
	}

	if (seconds < SECONDS_PER_HOUR) {
		return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ago`
	}

	if (seconds < SECONDS_PER_DAY) {
		return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`
	}

	if (seconds < SECONDS_PER_WEEK) {
		return `${Math.floor(seconds / SECONDS_PER_DAY)}d ago`
	}

	return `${Math.floor(seconds / SECONDS_PER_WEEK)}w ago`
}

function shortenKey(publicKey: string): string {
	return `${publicKey.slice(START_INDEX, PUBLIC_KEY_PREFIX_LENGTH)}...`
}

function usage(): void {
	logError('Invalid peers command.')
	write(dim('Usage: hbeam peers add <name> <public-key>'))
	write(dim('       hbeam peers rm <name>'))
	write(dim('       hbeam peers ls'))
}

async function handleAdd(name: string | undefined, publicKey: string | undefined): Promise<number> {
	if (!name || !publicKey) {
		blank()
		usage()
		blank()
		return EXIT_FAILURE
	}

	try {
		await addPeer(name, publicKey)
	} catch (error) {
		blank()
		logError((error as Error).message)
		blank()
		return EXIT_FAILURE
	}

	blank()
	log(bold('SAVED'))
	write(cyan(name))
	blank()

	return EXIT_SUCCESS
}

async function handleRemove(name: string | undefined): Promise<number> {
	if (!name) {
		blank()
		usage()
		blank()
		return EXIT_FAILURE
	}

	const peer = await getPeer(name).catch(() => undefined)

	if (!peer) {
		blank()
		logError(`Unknown peer: ${name}`)
		blank()
		return EXIT_FAILURE
	}

	blank()
	const approved = await confirm(`REMOVE ${name}?`)

	if (!approved) {
		log(dim('CANCELLED'))
		blank()
		return EXIT_SUCCESS
	}

	await removePeer(name)
	log(bold('REMOVED'))
	blank()

	return EXIT_SUCCESS
}

async function handleList(): Promise<number> {
	const peers = await listPeers()

	blank()
	log(bold('PEERS'))

	if (peers.length === EMPTY_PEERS) {
		write(dim('No peers saved yet.'))
		blank()
		return EXIT_SUCCESS
	}

	blank()

	for (const peer of peers) {
		write(`${peer.name}  ${dim(shortenKey(peer.publicKey))}  ${dim(formatAge(peer.addedAt))}`)
	}

	blank()

	return EXIT_SUCCESS
}

/** Execute `hbeam peers` subcommands. */
export async function runPeersCommand(argv: string[]): Promise<number> {
	const [action, name, publicKey] = argv

	if (action === 'add') {
		return handleAdd(name, publicKey)
	}

	if (action === 'rm') {
		return handleRemove(name)
	}

	if (action === 'ls') {
		return handleList()
	}

	blank()
	usage()
	blank()

	return EXIT_FAILURE
}
