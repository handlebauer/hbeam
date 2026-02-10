import { blue, bold, dim, green, red } from 'colorette'

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TypeScript tooling configuration.
 *
 * Centralizes the TypeScript runner used for type checking across the monorepo.
 * Change `TYPESCRIPT_RUNNER` to switch implementations.
 */
export const TypeScriptPackages = {
	nativePreview: '@typescript/native-preview',
	tsc: 'tsc',
} as const

/**
 * TypeScript tool runner configuration.
 *
 * Note: `bunx` runs executables, not packages. Some packages provide a binary name
 * that differs from the package name (e.g. `@typescript/native-preview` provides `tsgo`),
 * so we model both explicitly to avoid flaky resolution.
 *
 * @see `https://www.npmjs.com/package/@typescript/native-preview`
 */
type TypeScriptRunner = Readonly<{
	bin: 'tsc' | 'tsgo'
	package: (typeof TypeScriptPackages)[keyof typeof TypeScriptPackages]
}>

export const TYPESCRIPT_RUNNER: TypeScriptRunner = {
	bin: 'tsgo',
	package: TypeScriptPackages.nativePreview,
}

// ─────────────────────────────────────────────────────────────────────────────
// Step runner
// ─────────────────────────────────────────────────────────────────────────────

const EXIT_INDENT = '  '
const INDENT_SPACES = 4
const MILLIS_PER_SECOND = 1000
const ROUND_MILLISECONDS = 0
const DURATION_DECIMALS = 2
const SPINNER_INTERVAL_MS = 80
const STARTING_FRAME_INDEX = 0
const NEXT_FRAME_STEP = 1
const CHECK_MARK = '\u2714'
const CROSS_MARK = '\u2716'
const ANSI_CLEAR_LINE = '\u001B[2K'
const ANSI_CURSOR_HIDE = '\u001B[?25l'
const ANSI_CURSOR_SHOW = '\u001B[?25h'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

type TaskStatus = 'pending' | 'running' | 'success' | 'error'

type RunStepOptions = Readonly<{
	replace?: boolean
}>

type ShellError = Error &
	Readonly<{
		exitCode: number
		stderr: Buffer
		stdout: Buffer
	}>

type RunTask<T> = () => T | Promise<T>

class Spinner {
	private frameIndex = STARTING_FRAME_INDEX
	private intervalId: ReturnType<typeof globalThis.setInterval> | undefined = undefined
	private lineWasRendered = false
	private status: TaskStatus = 'pending'
	private text: string

	constructor(text: string) {
		this.text = text
	}

	start(): void {
		if (!isInteractive()) {
			return
		}
		process.stdout.write(ANSI_CURSOR_HIDE)
		this.status = 'running'
		this.render()
		this.intervalId = globalThis.setInterval(() => {
			this.frameIndex = (this.frameIndex + NEXT_FRAME_STEP) % SPINNER_FRAMES.length
			this.render()
		}, SPINNER_INTERVAL_MS)
	}

	update(status: TaskStatus, text?: string): void {
		this.status = status
		if (text) {
			this.text = text
		}
	}

	stop(): void {
		if (this.intervalId) {
			globalThis.clearInterval(this.intervalId)
			this.intervalId = undefined
		}
		if (!isInteractive()) {
			return
		}
		this.render()
		process.stdout.write(ANSI_CURSOR_SHOW)
	}

	clear(): void {
		if (this.intervalId) {
			globalThis.clearInterval(this.intervalId)
			this.intervalId = undefined
		}
		if (isInteractive() && this.lineWasRendered) {
			process.stdout.write(`\r${ANSI_CLEAR_LINE}`)
			process.stdout.write(ANSI_CURSOR_SHOW)
			this.lineWasRendered = false
		}
	}

	private render(): void {
		const line = formatSpinnerLine(
			this.status,
			this.text,
			SPINNER_FRAMES[this.frameIndex] ?? ' ',
		)
		process.stdout.write(`\r${ANSI_CLEAR_LINE}${line}`)
		if (this.status === 'success' || this.status === 'error') {
			process.stdout.write('\n')
		}
		this.lineWasRendered = true
	}
}

function isInteractive(): boolean {
	return Boolean(process.stdout.isTTY)
}

function formatSpinnerLine(status: TaskStatus, text: string, frame: string): string {
	if (status === 'running') {
		return `${blue(frame)} ${text}`
	}
	if (status === 'success') {
		return `${green(CHECK_MARK)} ${text}`
	}
	if (status === 'error') {
		return `${red(CROSS_MARK)} Failed: ${text}`
	}
	return text
}

/**
 * Check whether an error carries shell output (stderr/stdout).
 *
 * Bun shell commands that fail throw a `ShellError` with Buffer
 * properties. This guard narrows the type without importing internals.
 *
 * @param error - The caught value
 * @returns True if the error has stderr and stdout buffers
 */
/**
 * Narrow an unknown error to a Bun ShellError.
 *
 * @param error - The caught value
 * @returns True if the error has exitCode, stderr, and stdout
 */
function isShellError(error: unknown): error is ShellError {
	return error instanceof Error && 'exitCode' in error && 'stderr' in error && 'stdout' in error
}

/**
 * Indent every line of a multi-line string.
 *
 * @param text - Text to indent
 * @param indent - Prefix string for each line
 * @returns Indented text
 */
function indentLines(text: string, indent: string): string {
	return text
		.split('\n')
		.map(line => `${indent}${line}`)
		.join('\n')
}

/**
 * Log the stderr/stdout from a failed shell command.
 *
 * @param error - The shell error
 */
function logShellError(error: ShellError): void {
	console.error(`${EXIT_INDENT}Exit Code: ${String(error.exitCode)}`)
	const stdout = error.stdout.toString().trim()
	const stderr = error.stderr.toString().trim()
	if (stdout) {
		console.error(`${EXIT_INDENT}Stdout:`)
		console.error(indentLines(stdout, ' '.repeat(INDENT_SPACES)))
	}
	if (stderr) {
		console.error(`${EXIT_INDENT}Stderr:`)
		console.error(indentLines(stderr, ' '.repeat(INDENT_SPACES)))
	}
}

/**
 * Log a formatted step failure with the label and error details.
 *
 * @param label - The step that failed
 * @param error - The caught value
 */
function logStepFailure(label: string, error: unknown): void {
	console.error(`✖ Failed: ${label}`)
	console.error('')
	if (isShellError(error)) {
		logShellError(error)
	} else if (error instanceof Error) {
		console.error(`${EXIT_INDENT}${error.message}`)
	}
}

/**
 * Run a task with spinner/timing and structured error output.
 *
 * Supports:
 * - `runStep('Done!')`
 * - `runStep('Running checks', fn, 'Checks passed')`
 * - `runStep('Publishing', fn, result => \`Published \${result.version}\`)`
 *
 * The `replace` option clears the spinner line on success instead of printing
 * a final success line.
 */
export async function runStep(text: string): Promise<void>
// eslint-disable-next-line max-params
export async function runStep<T>(
	text: string,
	action: RunTask<T>,
	successText?: string | ((result: T) => string),
	options?: RunStepOptions,
): Promise<T>
// eslint-disable-next-line max-params
export async function runStep<T>(
	text: string,
	action?: RunTask<T>,
	successText?: string | ((result: T) => string),
	options?: RunStepOptions,
): Promise<T | void> {
	const spinner = new Spinner(text)

	if (!action) {
		spinner.start()
		spinner.update('success', bold(text))
		spinner.stop()
		return
	}

	spinner.start()
	const startTimeMs = Date.now()

	try {
		const result = await action()
		if (options?.replace) {
			spinner.clear()
		} else {
			const finalText =
				typeof successText === 'function' ? successText(result) : (successText ?? text)
			spinner.update('success', `${bold(finalText)} ${formatDuration(startTimeMs)}`)
			spinner.stop()
		}
		return result
	} catch (error: unknown) {
		spinner.update('error')
		spinner.stop()
		logStepFailure(text, error)
		throw error
	}
}

function formatDuration(startTimeMs: number): string {
	const elapsedMs = Date.now() - startTimeMs
	const formatted =
		elapsedMs < MILLIS_PER_SECOND
			? `${Math.round(elapsedMs).toFixed(ROUND_MILLISECONDS)}ms`
			: `${(elapsedMs / MILLIS_PER_SECOND).toFixed(DURATION_DECIMALS)}s`
	return dim(`[${formatted}]`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Source file scanning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Directories to exclude from source file scanning.
 */
const EXCLUDED_DIRS = ['node_modules/', 'dist/', '.next/', '.turbo/']

/**
 * Check whether a file path should be skipped during scanning.
 *
 * @param filePath - Relative file path to check
 * @returns True if the file is in an excluded directory or is a declaration file
 */
function isExcludedPath(filePath: string): boolean {
	if (filePath.endsWith('.d.ts')) {
		return true
	}
	return EXCLUDED_DIRS.some(dir => filePath.includes(dir))
}

/**
 * Build the full relative path from a scan result.
 *
 * @param directory - The scanned directory
 * @param path - The path relative to the scanned directory
 * @returns Full relative path from the project root
 */
function buildFilePath(directory: string, path: string): string {
	if (directory === '.') {
		return path
	}
	return `${directory}/${path}`
}

/**
 * Get all TypeScript source files matching the given options.
 *
 * Scans for `.ts` and `.tsx` files, excluding common non-source
 * directories (node_modules, dist, .next, .turbo) and declaration files.
 *
 * @param options - Configuration options
 * @param options.directory - Root directory to scan (defaults to ".")
 * @param options.exclude - Optional predicate; return true to skip a file
 * @returns Sorted array of relative file paths
 */
export function getSourceFiles(options?: {
	directory?: string
	exclude?: (filePath: string) => boolean
}): string[] {
	const directory = (options && options.directory) || '.'
	const exclude = options && options.exclude

	const glob = new Bun.Glob('**/*.{ts,tsx}')
	const paths = [...glob.scanSync(directory)]

	return paths
		.map(scanned => buildFilePath(directory, scanned))
		.filter(file => !isExcludedPath(file))
		.filter(file => !exclude || !exclude(file))
		.toSorted()
}
