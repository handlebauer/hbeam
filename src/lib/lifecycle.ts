import { blank, clearLine, dim, log } from './log.ts'

import type { Beam } from '../beam.ts'

/** Exit code indicating failure. */
const EXIT_FAILURE = 1

/** Grace period (ms) before force-killing on shutdown. */
const SHUTDOWN_TIMEOUT_MS = 2000

/** Controller for graceful shutdown of a beam session. */
export interface Lifecycle {
	/** Returns true if shutdown is in progress (use as an early-return guard). */
	done(): boolean
	/** Tear down the beam, stop the spinner, and exit after a grace period. */
	shutdown(): void
}

/**
 * Create a lifecycle controller that manages SIGINT handling and graceful shutdown.
 *
 * Registers a one-shot SIGINT handler on creation. All shutdown state is
 * encapsulated — callers just check `done()` and call `shutdown()`.
 */
export function createLifecycle(beam: Beam, spinner?: { stop(): void }): Lifecycle {
	let isShuttingDown = false

	function shutdown(): void {
		if (isShuttingDown) {
			return
		}
		isShuttingDown = true
		spinner?.stop()

		log(dim('SHUTTING DOWN'))
		blank()

		const timeout = globalThis.setTimeout(() => {
			process.exit(EXIT_FAILURE)
		}, SHUTDOWN_TIMEOUT_MS)

		beam.destroy()
		beam.on('close', () => {
			globalThis.clearTimeout(timeout)
		})
	}

	process.once('SIGINT', () => {
		clearLine()
		shutdown()
	})

	return {
		done(): boolean {
			return isShuttingDown
		},
		shutdown,
	}
}
