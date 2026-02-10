#!/usr/bin/env bun
/**
 * Run all code quality checks across the monorepo.
 *
 * Checks: TypeScript, linting, JSDoc, type locations.
 */
import { TYPESCRIPT_RUNNER, runStep } from './utils'

import { $ } from 'bun'

const ARGV_OFFSET = 2
const EXIT_FAILURE = 1

try {
	await runStep(
		'Running type check',
		() =>
			$`bunx -p ${TYPESCRIPT_RUNNER.package} ${TYPESCRIPT_RUNNER.bin} --build --noEmit ${process.argv.slice(ARGV_OFFSET)}`.quiet(),
		'Type check complete',
	)

	await runStep('Running lint check', () => $`bun run lint`.quiet(), 'Lint check complete')
} catch {
	console.error('Checks failed')
	console.error('')
	console.error('Please fix the errors and run `bun check` again.')
	console.error('Note: run `bun check` with "all" permissions to ensure success.')
	process.exit(EXIT_FAILURE)
}
