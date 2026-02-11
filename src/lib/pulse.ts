import { bold, dim } from 'colorette'

const INTERVAL_MS = 125
const PEAK_A = 5
const PEAK_B = 15
const PEAK_WRAP = 25
const DIST_PEAK = 0
const DIST_NEAR = 1

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
	'     ',
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
