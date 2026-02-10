import { dim, red, yellow } from 'colorette'

export { bold, cyan, dim, gray, green, italic, red, yellow } from 'colorette'

export const INDENT = '  '

/** Width of the visual separator line. */
const SEPARATOR_WIDTH = 36

/** A dim dashed line used to bracket piped content. */
export const SEPARATOR = dim('╌'.repeat(SEPARATOR_WIDTH))

/** ANSI escape: clear the entire current line and reset cursor to column 0. */
const CLEAR_LINE = '\r\u001B[2K'

/** Zero offset — cursor is on the spinner line itself. */
const NO_OFFSET = 0

/** Write a line to stderr at the standard indent level. */
export function write(message: string): void {
	process.stderr.write(`${INDENT}${message}\n`)
}

/** Write a blank line to stderr. */
export function blank(): void {
	process.stderr.write('\n')
}

/** Write a pre-formatted block (multiple lines) to stderr. */
export function writeBlock(lines: string[]): void {
	for (const line of lines) {
		process.stderr.write(`${INDENT}${line}\n`)
	}
}

/** Write a status message to stderr at the standard indent level. */
export function log(message: string): void {
	write(message)
}

/** Write an error message to stderr at the standard indent level. */
export function logError(message: string): void {
	process.stderr.write(`${INDENT}${red('ERROR')} ${message}\n`)
}

/** Write a warning/notice message to stderr with a yellow prefix. */
export function logWarn(message: string): void {
	process.stderr.write(`${yellow('!')} ${message}\n`)
}

/** Clear the current line (wipe terminal-echoed ^C, etc.). Falls back to a newline on non-TTY. */
export function clearLine(): void {
	if (process.stderr.isTTY) {
		process.stderr.write(CLEAR_LINE)
	} else {
		process.stderr.write('\n')
	}
}

// -- Spinner ----------------------------------------------------------------

/** ANSI escape: move cursor up N lines. */
function cursorUp(n: number): string {
	return `\u001B[${n}A`
}

/** ANSI escape: move cursor down N lines. */
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

/** Animate a single line in-place while content continues to print below it. */
export function createSpinner(frames: readonly string[], intervalMs: number): Spinner {
	let offset = NO_OFFSET
	let frameIndex = NO_OFFSET
	let timer: ReturnType<typeof globalThis.setInterval> | undefined = undefined

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
