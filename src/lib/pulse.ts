import { bold, dim } from 'colorette'

/** Delay between spinner frames (ms). */
const INTERVAL_MS = 125

/** Frame index of the first peak in the pulse animation. */
const PEAK_A = 5

/** Frame index of the second peak in the pulse animation. */
const PEAK_B = 13

/** Wrapped peak used to calculate distance for the last frames in the loop. */
const PEAK_WRAP = 20

/** Distance from peak at which the frame is rendered at full brightness. */
const DIST_PEAK = 0

/** Distance from peak at which the frame is rendered at normal brightness. */
const DIST_NEAR = 1

/** Raw dot-pulse frames that sweep left-to-right and back. */
const RAW_FRAMES: readonly string[] = [
	'     ',
	'·    ',
	'··   ',
	'···  ',
	'···· ',
	'·····',
	' ····',
	'  ···',
	'   ··',
	'    ·',
	'   ··',
	'  ···',
	' ····',
	'·····',
	'···· ',
	'···  ',
	'··   ',
	'·    ',
	'     ',
]

/**
 * Generate the styled spinner frames for the HBEAM pulse animation.
 *
 * Each frame is rendered with a brightness gradient: bold at peak,
 * normal near peak, and dim everywhere else.
 *
 * @param label - The text label to prefix each frame (e.g. "HBEAM").
 * @returns An object with the styled `frames` array and `intervalMs` timing.
 */
export function createPulseFrames(label: string): { frames: string[]; intervalMs: number } {
	const frames = RAW_FRAMES.map((s, i) => {
		const distanceToPeak = Math.min(
			Math.abs(i - PEAK_A),
			Math.abs(i - PEAK_B),
			Math.abs(i - PEAK_WRAP),
		)
		let glyph = dim(s)
		if (distanceToPeak === DIST_PEAK) {
			glyph = bold(s)
		} else if (distanceToPeak === DIST_NEAR) {
			glyph = s
		}
		return `${bold(label)} ${glyph}`
	})

	return { frames, intervalMs: INTERVAL_MS }
}
