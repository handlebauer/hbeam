/**
 * Cross-platform clipboard integration for terminal workflows.
 *
 * Tries common platform-native clipboard commands in priority order.
 *
 * @module
 */
import { spawnSync } from 'node:child_process'

type ClipboardCommand = Readonly<{
	args: readonly string[]
	command: string
}>

const EXIT_SUCCESS = 0
const EMPTY_ARGS: readonly string[] = []

const DARWIN_COMMANDS: readonly ClipboardCommand[] = [{ args: EMPTY_ARGS, command: 'pbcopy' }]
const WINDOWS_COMMANDS: readonly ClipboardCommand[] = [{ args: EMPTY_ARGS, command: 'clip' }]

const LINUX_COMMANDS: readonly ClipboardCommand[] = [
	{ args: EMPTY_ARGS, command: 'wl-copy' },
	{ args: ['-selection', 'clipboard'], command: 'xclip' },
	{ args: ['--clipboard', '--input'], command: 'xsel' },
]

/**
 * Resolve the clipboard command list for the current platform.
 *
 * @returns Ordered command list to try for clipboard writes.
 */
function getClipboardCommands(): readonly ClipboardCommand[] {
	if (process.platform === 'darwin') {
		return DARWIN_COMMANDS
	}
	if (process.platform === 'win32') {
		return WINDOWS_COMMANDS
	}
	return LINUX_COMMANDS
}

/**
 * Attempt to write text to clipboard with a specific command.
 *
 * @param text - Text to place in clipboard.
 * @param item - Clipboard command and argument tuple.
 * @returns True when command succeeds.
 */
function tryClipboardCommand(text: string, item: ClipboardCommand): boolean {
	const result = spawnSync(item.command, item.args, {
		input: text,
		stdio: ['pipe', 'ignore', 'ignore'],
	})
	return !result.error && result.status === EXIT_SUCCESS
}

/**
 * Copy text to the system clipboard using common platform commands.
 *
 * @param text - Text to copy.
 * @returns True when at least one command succeeds.
 */
export function copyToClipboard(text: string): boolean {
	for (const item of getClipboardCommands()) {
		if (tryClipboardCommand(text, item)) {
			return true
		}
	}
	return false
}
