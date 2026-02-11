import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TMP_HOME_PREFIX = 'hbeam-test-home-'
const CONFIG_ROOT_DIR = '.config'
const APP_CONFIG_DIR = 'hbeam'
const CONFIG_DIR_ENV = 'HBEAM_CONFIG_DIR'
const HEX_RADIX = 16
const TOKEN_START = 2

type TempHomeContext = Readonly<{
	homeDir: string
}>

/**
 * Run a test callback with HOME redirected to an isolated temporary directory.
 */
export async function withTempHome<T>(run: (context: TempHomeContext) => Promise<T>): Promise<T> {
	const originalHome = process.env.HOME
	const originalConfigDir = process.env[CONFIG_DIR_ENV]
	const homeDir = await mkdtemp(join(tmpdir(), TMP_HOME_PREFIX))
	process.env.HOME = homeDir
	process.env[CONFIG_DIR_ENV] = join(homeDir, CONFIG_ROOT_DIR, APP_CONFIG_DIR)

	try {
		return await run({ homeDir })
	} finally {
		if (originalHome) {
			process.env.HOME = originalHome
		} else {
			delete process.env.HOME
		}
		if (originalConfigDir) {
			process.env[CONFIG_DIR_ENV] = originalConfigDir
		} else {
			delete process.env[CONFIG_DIR_ENV]
		}
		await rm(homeDir, { force: true, recursive: true })
	}
}

/** Import a module with a unique query string to bypass ESM cache. */
export async function importFresh<T>(baseDir: string, modulePath: string): Promise<T> {
	const token = `${Date.now()}-${Math.random().toString(HEX_RADIX).slice(TOKEN_START)}`
	const absolutePath = resolve(baseDir, modulePath)
	const href = pathToFileURL(absolutePath).href
	return (await import(`${href}?t=${token}`)) as T
}
