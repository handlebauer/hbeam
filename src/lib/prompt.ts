import { INDENT, dim } from './log.ts'

const YES = 'y'
const NO = 'n'
const CTRL_C = '\u0003'
const ENTER = '\r'
const FIRST_CHAR_INDEX = 0

function firstChar(data: Buffer): string {
	return data.toString('utf8').toLowerCase().charAt(FIRST_CHAR_INDEX)
}

/** Minimal single-keypress confirm prompt with `y/N` default. */
export async function confirm(message: string): Promise<boolean> {
	process.stderr.write(`${INDENT}${message} ${dim('(y/N)')} `)

	const stdin = process.stdin
	if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
		process.stderr.write('\n')
		return false
	}

	const originalRaw = stdin.isRaw

	return await new Promise<boolean>(resolve => {
		function cleanup(answer: boolean): void {
			stdin.setRawMode(Boolean(originalRaw))
			stdin.pause()
			stdin.removeListener('data', onData)
			process.stderr.write(`${answer ? YES : NO}\n`)
			resolve(answer)
		}

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
