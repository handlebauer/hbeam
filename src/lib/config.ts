/**
 * Config-directory utilities for hbeam local state.
 *
 * Provides path resolution and JSON read/write helpers under `~/.config/hbeam`
 * (or an override directory via environment variable).
 *
 * @module
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CONFIG_ROOT_DIR = '.config'
const APP_CONFIG_DIR = 'hbeam'
const CONFIG_DIR_ENV = 'HBEAM_CONFIG_DIR'

const DIR_MODE = 0o700
const FILE_MODE_SECURE = 0o600

/**
 * Resolve the absolute path to the hbeam config directory.
 *
 * @returns Config directory path, honoring `HBEAM_CONFIG_DIR` when set.
 */
export function getConfigDir(): string {
	return process.env[CONFIG_DIR_ENV] ?? join(homedir(), CONFIG_ROOT_DIR, APP_CONFIG_DIR)
}

/**
 * Resolve a filename under the hbeam config directory.
 *
 * @param filename - Relative config filename.
 * @returns Absolute path to the config file.
 */
function resolveConfigPath(filename: string): string {
	return join(getConfigDir(), filename)
}

/**
 * Ensure the hbeam config directory exists with private directory permissions.
 *
 * @returns Promise that resolves once the directory exists.
 */
export async function ensureConfigDir(): Promise<void> {
	await mkdir(getConfigDir(), { mode: DIR_MODE, recursive: true })
}

/**
 * Read and parse a JSON file from the hbeam config directory.
 *
 * @param filename - Relative config filename.
 * @returns Parsed JSON object, or `undefined` when file does not exist.
 */
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
 *
 * @param filename - Relative config filename.
 * @param data - Serializable payload.
 * @param options - Write options.
 * @returns Promise that resolves when file write is complete.
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
