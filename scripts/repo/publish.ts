#!/usr/bin/env bun
import { ExitPromptError } from '@inquirer/core'
import { select } from '@inquirer/prompts'
/**
 * Publish the package to npm.
 *
 * Handles version bumping, publishing, and rollback on failure.
 *
 * Usage:
 *   bun scripts/publish.ts [--patch|--minor|--major|--alpha]
 */
import { $ } from 'bun'
import { bold } from 'colorette'
import mri from 'mri'

import { runStep } from '../checks/utils.ts'

const EXIT_SUCCESS = 0
const ARGV_OFFSET = 2
const ALPHA_MATCH_GROUP_INDEX = 1
const DECIMAL_RADIX = 10
const ALPHA_INCREMENT = 1
const MILLISECONDS_PER_SECOND = 1000
const DURATION_DECIMALS = 2

process.on('uncaughtException', error => {
	if (error instanceof ExitPromptError) {
		process.exit(EXIT_SUCCESS)
	}
	throw error
})

const startTimeMs = Date.now()

const { default: originalPkg } = (await import('../../package.json', {
	with: { type: 'json' },
})) as {
	default: { name: string; version: string }
}

console.log()
console.log(bold(` ${originalPkg.name}@${originalPkg.version}`))
console.log()

// ─────────────────────────────────────────────────────────────────────────────
// Parse Arguments
// ─────────────────────────────────────────────────────────────────────────────

type PublishType = 'patch' | 'minor' | 'major' | 'alpha'

const args = mri(process.argv.slice(ARGV_OFFSET), {
	boolean: ['alpha', 'major', 'minor', 'patch'],
})

let publishType: PublishType | undefined = undefined

if (args.patch) {
	publishType = 'patch'
} else if (args.minor) {
	publishType = 'minor'
} else if (args.major) {
	publishType = 'major'
} else if (args.alpha) {
	publishType = 'alpha'
}

if (!publishType) {
	publishType = await select({
		choices: [
			{ name: 'Patch (bug fixes)', value: 'patch' as const },
			{ name: 'Minor (new features)', value: 'minor' as const },
			{ name: 'Major (breaking changes)', value: 'major' as const },
			{ name: 'Alpha (early testing)', value: 'alpha' as const },
		],
		message: 'Select version bump type:',
	})
}

const isAlpha = publishType === 'alpha'
const publishTag = isAlpha ? 'alpha' : 'latest'

// ─────────────────────────────────────────────────────────────────────────────
// Alpha Version Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the next alpha version number.
 *
 * Checks npm for existing alpha versions and increments.
 *
 * @param pkgName - Package name
 * @param baseVersion - Current base version (e.g., "1.0.0")
 * @returns Next alpha version (e.g., "1.0.0-alpha.1")
 */
async function getAlphaVersion(pkgName: string, baseVersion: string): Promise<string> {
	let alphaNum = 0
	try {
		const latestAlphaResult = await $`bun pm view ${pkgName}@alpha version`.text()
		const latestAlpha = latestAlphaResult.trim()
		if (latestAlpha.startsWith(`${baseVersion}-alpha.`)) {
			const match = latestAlpha.match(/-alpha\.(\d+)$/)
			if (match?.[ALPHA_MATCH_GROUP_INDEX]) {
				alphaNum = parseInt(match[ALPHA_MATCH_GROUP_INDEX], DECIMAL_RADIX)
			}
		}
	} catch {
		// No alpha version exists yet
	}
	return `${baseVersion}-alpha.${alphaNum + ALPHA_INCREMENT}`
}

let targetVersion: string | undefined = undefined

if (isAlpha) {
	targetVersion = await getAlphaVersion(originalPkg.name, originalPkg.version)
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Run Checks
// ─────────────────────────────────────────────────────────────────────────────

await runStep('Running checks', () => $`bun run check`.quiet(), 'Checks passed')

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Bump Version
// ─────────────────────────────────────────────────────────────────────────────

await runStep(
	isAlpha ? 'Bumping alpha version' : 'Bumping version',
	async () => {
		if (isAlpha) {
			if (!targetVersion) {
				throw new Error('Failed to calculate target alpha version')
			}
			await $`bunx bumpp ${targetVersion} --no-tag --no-push --no-commit --yes`.quiet()
		} else {
			await $`bunx bumpp ${publishType} --no-tag --no-push --no-commit --yes`.quiet()
		}
	},
	isAlpha ? 'Alpha version bumped' : 'Version bumped',
)

const pkg = JSON.parse(await Bun.file('./package.json').text()) as { name: string; version: string }

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Publish
// ─────────────────────────────────────────────────────────────────────────────

try {
	await runStep(
		'Publishing to npm',
		() => $`bun publish --access public --tag ${publishTag}`.quiet(),
		`Published ${pkg.name}@${pkg.version}`,
	)
} catch (error) {
	// Rollback version on failure
	await runStep(
		'Rolling back version',
		() => $`bunx bumpp ${originalPkg.version} --no-tag --no-push --no-commit --yes`.quiet(),
		`Rolled back to ${originalPkg.name}@${originalPkg.version}`,
	)
	throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Cleanup
// ─────────────────────────────────────────────────────────────────────────────

if (isAlpha) {
	await runStep(
		'Reverting version in package.json',
		() => $`bunx bumpp ${originalPkg.version} --no-tag --no-push --no-commit --yes`.quiet(),
		`Reverted to ${originalPkg.version} in package.json`,
	)
}

const duration = ((Date.now() - startTimeMs) / MILLISECONDS_PER_SECOND).toFixed(DURATION_DECIMALS)
await runStep(`Published in ${duration}s!`)
