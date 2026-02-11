/**
 * Minimal interactive prompt helpers for CLI sessions.
 *
 * Includes raw-key confirmation prompts and editable line-input prompts.
 *
 * @module
 */
import { createInterface } from 'node:readline/promises'

import { INDENT, dim } from './log.ts'

const YES = 'y'
const NO = 'n'
const CTRL_C = '\u0003'
const ENTER = '\r'
const FIRST_CHAR_INDEX = 0
const EMPTY_INPUT = ''

/**
 * Extract the normalized first character from a stdin buffer.
 *
 * @param data - Raw stdin chunk.
 * @returns Lowercased first character, or empty string.
 */
function firstChar(data: Buffer): string {
	return data.toString('utf8').toLowerCase().charAt(FIRST_CHAR_INDEX)
}

/**
 * Prompt for a yes/no confirmation with `y/N` semantics.
 *
 * @param message - Prompt message body.
 * @returns True when user confirms with `y`.
 */
export async function confirm(message: string): Promise<boolean> {
	process.stderr.write(`${INDENT}${message} ${dim('(y/N)')} `)

	const stdin = process.stdin
	if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
		process.stderr.write('\n')
		return false
	}

	const originalRaw = stdin.isRaw

	return await new Promise<boolean>(resolve => {
		/**
		 * Restore terminal state and resolve prompt result.
		 *
		 * @param answer - Final confirmation result.
		 * @returns Nothing.
		 */
		function cleanup(answer: boolean): void {
			stdin.setRawMode(Boolean(originalRaw))
			stdin.pause()
			stdin.removeListener('data', onData)
			process.stderr.write(`${answer ? YES : NO}\n`)
			resolve(answer)
		}

		/**
		 * Handle raw keypress bytes for the confirmation prompt.
		 *
		 * @param data - Raw stdin bytes.
		 * @returns Nothing.
		 */
		function onData(data: Buffer): void {
			const key = firstChar(data)
			if (key === CTRL_C) {
				process.stderr.write('\n')
				process.kill(process.pid, 'SIGINT')
				cleanup(false)
				return
			}
			if (key === YES) {
				cleanup(true)
				return
			}
			if (key === NO || key === '' || key === ENTER) {
				cleanup(false)
			}
		}

		stdin.setRawMode(true)
		stdin.resume()
		stdin.on('data', onData)
	})
}

/**
 * Prompt for line input with an editable pre-filled placeholder.
 *
 * @param message - Prompt message body.
 * @param placeholder - Default value shown to the user.
 * @returns User-entered value, or placeholder when input is empty/non-interactive.
 */
export async function input(message: string, placeholder: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stderr.isTTY) {
		return placeholder
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
		terminal: true,
	})

	try {
		const answerPromise = rl.question(`${INDENT}${message} `)
		rl.write(placeholder)
		const answer = await answerPromise
		const trimmed = answer.trim()

		return trimmed === EMPTY_INPUT ? placeholder : trimmed
	} finally {
		rl.close()
	}
}
