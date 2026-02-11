/**
 * Terminal output primitives and animated spinner utilities.
 *
 * Centralizes formatted stderr logging and in-place spinner rendering.
 *
 * @module
 */
import { dim, red, yellow } from 'colorette'

export { bold, cyan, dim, gray, green, italic, red, yellow } from 'colorette'

const SEPARATOR_WIDTH = 36
const CLEAR_LINE = '\r\u001B[2K'
const NO_OFFSET = 0

export const INDENT = '  '
export const SEPARATOR = dim('╌'.repeat(SEPARATOR_WIDTH))

/**
 * Write a line to stderr at the standard indent level.
 *
 * @param message - Text to print.
 * @param indent - Prefix to prepend before the message.
 * @returns Nothing.
 */
export function write(message: string, indent: string = INDENT): void {
	process.stderr.write(`${indent}${message}\n`)
}

/**
 * Write a blank line to stderr.
 *
 * @returns Nothing.
 */
export function blank(): void {
	process.stderr.write('\n')
}

/**
 * Write a pre-formatted block (multiple lines) to stderr.
 *
 * @param lines - Lines to print.
 * @returns Nothing.
 */
export function writeBlock(lines: string[]): void {
	for (const line of lines) {
		process.stderr.write(`${INDENT}${line}\n`)
	}
}

/**
 * Write a status message to stderr at the standard indent level.
 *
 * @param message - Status text.
 * @returns Nothing.
 */
export function log(message: string): void {
	write(message)
}

/**
 * Write an error message to stderr at the standard indent level.
 *
 * @param message - Error text.
 * @returns Nothing.
 */
export function logError(message: string): void {
	process.stderr.write(`${INDENT}${red('ERROR')} ${message}\n`)
}

/**
 * Write a warning/notice message to stderr with a yellow prefix.
 *
 * @param message - Warning text.
 * @returns Nothing.
 */
export function logWarn(message: string): void {
	process.stderr.write(`${yellow('!')} ${message}\n`)
}

/**
 * Clear the current terminal line, falling back to newline on non-TTY.
 *
 * @returns Nothing.
 */
export function clearLine(): void {
	if (process.stderr.isTTY) {
		process.stderr.write(CLEAR_LINE)
	} else {
		process.stderr.write('\n')
	}
}

// -- Spinner ----------------------------------------------------------------

/**
 * Build ANSI sequence to move cursor up N lines.
 *
 * @param n - Number of lines.
 * @returns ANSI escape sequence.
 */
function cursorUp(n: number): string {
	return `\u001B[${n}A`
}

/**
 * Build ANSI sequence to move cursor down N lines.
 *
 * @param n - Number of lines.
 * @returns ANSI escape sequence.
 */
function cursorDown(n: number): string {
	return `\u001B[${n}B`
}

/** Handle for a line that animates in-place while content prints below. */
export interface Spinner {
	/** Write a blank line below the spinner and track the cursor offset. */
	blank(): void
	/** Render the first frame and begin the animation loop. */
	start(): void
	/** Stop the animation loop. */
	stop(): void
	/** Write an indented line below the spinner and track the cursor offset. */
	write(message: string): void
}

/**
 * Animate a single line in-place while content continues to print below it.
 *
 * @param frames - Spinner frame strings.
 * @param intervalMs - Frame interval in milliseconds.
 * @returns Spinner controller for writing/stopping.
 */
export function createSpinner(frames: readonly string[], intervalMs: number): Spinner {
	let offset = NO_OFFSET
	let frameIndex = NO_OFFSET
	let timer: ReturnType<typeof globalThis.setInterval> | undefined = undefined

	/**
	 * Render the current frame in-place at the spinner cursor location.
	 *
	 * @returns Nothing.
	 */
	function render(): void {
		if (offset > NO_OFFSET) {
			process.stderr.write(cursorUp(offset))
		}
		process.stderr.write(`${CLEAR_LINE}${INDENT}${frames[frameIndex]}`)
		if (offset > NO_OFFSET) {
			process.stderr.write(`${cursorDown(offset)}\r`)
		}
		frameIndex++
		if (frameIndex >= frames.length) {
			frameIndex = NO_OFFSET
		}
	}

	return {
		blank(): void {
			blank()
			offset++
		},
		start(): void {
			render()
			process.stderr.write('\n')
			offset++
			timer = globalThis.setInterval(render, intervalMs)
		},
		stop(): void {
			if (timer) {
				globalThis.clearInterval(timer)
				timer = undefined
			}
		},
		write(message: string): void {
			write(message)
			offset++
		},
	}
}
