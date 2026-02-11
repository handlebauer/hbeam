import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CONFIG_ROOT_DIR = '.config'
const APP_CONFIG_DIR = 'hbeam'
const CONFIG_DIR_ENV = 'HBEAM_CONFIG_DIR'

const DIR_MODE = 0o700
const FILE_MODE_SECURE = 0o600

/** Absolute path to hbeam config directory. */
export function getConfigDir(): string {
	return process.env[CONFIG_DIR_ENV] ?? join(homedir(), CONFIG_ROOT_DIR, APP_CONFIG_DIR)
}

function resolveConfigPath(filename: string): string {
	return join(getConfigDir(), filename)
}

/** Ensure `~/.config/hbeam` exists with private directory permissions. */
export async function ensureConfigDir(): Promise<void> {
	await mkdir(getConfigDir(), { mode: DIR_MODE, recursive: true })
}

/** Read and parse a JSON file from the hbeam config directory. */
export async function readJsonFile<T>(filename: string): Promise<T | undefined> {
	const path = resolveConfigPath(filename)
	try {
		const raw = await readFile(path, 'utf8')
		return JSON.parse(raw) as T
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return undefined
		}
		throw error
	}
}

/**
 * Write a JSON file into the hbeam config directory.
 *
 * Set `secure` for files containing private key material.
 */
export async function writeJsonFile(
	filename: string,
	data: unknown,
	options?: { secure?: boolean },
): Promise<void> {
	const path = resolveConfigPath(filename)
	await ensureConfigDir()
	await mkdir(dirname(path), { mode: DIR_MODE, recursive: true })
	await writeFile(path, `${JSON.stringify(data, null, '\t')}\n`, 'utf8')
	if (options?.secure) {
		await chmod(path, FILE_MODE_SECURE)
	}
}
