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

function getClipboardCommands(): readonly ClipboardCommand[] {
	if (process.platform === 'darwin') {
		return DARWIN_COMMANDS
	}
	if (process.platform === 'win32') {
		return WINDOWS_COMMANDS
	}
	return LINUX_COMMANDS
}

function tryClipboardCommand(text: string, item: ClipboardCommand): boolean {
	const result = spawnSync(item.command, item.args, {
		input: text,
		stdio: ['pipe', 'ignore', 'ignore'],
	})
	return !result.error && result.status === EXIT_SUCCESS
}

/** Copy text to the system clipboard using common platform commands. */
export function copyToClipboard(text: string): boolean {
	for (const item of getClipboardCommands()) {
		if (tryClipboardCommand(text, item)) {
			return true
		}
	}
	return false
}
