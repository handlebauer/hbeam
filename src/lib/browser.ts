/**
 * Cross-platform browser launcher helpers.
 *
 * @module
 */
import { execFile } from 'node:child_process'

interface BrowserCommand {
	args: string[]
	command: string
}

/**
 * Resolve the default browser opener command for current platform.
 *
 * @param url - URL to open.
 * @returns Command tuple to execute.
 */
function getBrowserCommand(url: string): BrowserCommand {
	if (process.platform === 'darwin') {
		return { args: [url], command: 'open' }
	}

	if (process.platform === 'win32') {
		return { args: ['/c', 'start', '', url], command: 'cmd' }
	}

	return { args: [url], command: 'xdg-open' }
}

/**
 * Open a URL in the user's default browser.
 *
 * @param url - URL to open.
 * @returns Resolves once the opener command completes.
 */
export function openBrowser(url: string): Promise<void> {
	const command = getBrowserCommand(url)

	return new Promise((resolve, reject) => {
		execFile(command.command, command.args, error => {
			if (error) {
				reject(error)
				return
			}

			resolve()
		})
	})
}
