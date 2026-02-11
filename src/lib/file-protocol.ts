/**
 * Line-delimited control-frame protocol for single-file transfers.
 *
 * Defines and parses file header frames and completion acknowledgement frames
 * exchanged between sender and receiver during `hbeam serve` sessions.
 *
 * @module
 */
const FILE_TYPE = 'file'
const FILE_COMPLETE_TYPE = 'file-complete'
const NEWLINE = '\n'
const BYTES_PER_KIB = 1024
const UNIT_PRECISION = 1
const FIRST_INDEX = 0
const MIN_SIZE = 0
const LAST_INDEX_OFFSET = 1
const UNIT_LABELS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export interface FileHeader {
	name: string
	size: number
	type: typeof FILE_TYPE
}

export interface FileCompletionAck {
	ok: boolean
	reason?: string
	type: typeof FILE_COMPLETE_TYPE
}

/**
 * Encode a file header as a newline-delimited JSON frame.
 *
 * @param header - File header payload.
 * @returns Encoded frame bytes.
 */
export function encodeHeader(header: FileHeader): Buffer {
	return Buffer.from(`${JSON.stringify(header)}${NEWLINE}`, 'utf8')
}

/**
 * Encode a completion acknowledgement as a newline-delimited JSON frame.
 *
 * @param ack - Completion acknowledgement payload.
 * @returns Encoded frame bytes.
 */
export function encodeCompletionAck(ack: FileCompletionAck): Buffer {
	return Buffer.from(`${JSON.stringify(ack)}${NEWLINE}`, 'utf8')
}

/**
 * Check whether buffered bytes begin with a file-header control frame.
 *
 * @param chunk - Buffered inbound bytes.
 * @returns True when the first line appears to be a file header.
 */
export function isFileHeader(chunk: Buffer): boolean {
	const lineEnd = findHeaderLineEnd(chunk)

	/**
	 * Header key order is not guaranteed by JSON serializers, so detection is
	 * intentionally permissive as long as the first line is JSON with `type:file`.
	 */
	const candidate = (lineEnd >= MIN_SIZE ? chunk.subarray(FIRST_INDEX, lineEnd) : chunk).toString(
		'utf8',
	)
	const trimmed = candidate.trimStart()

	return trimmed.startsWith('{') && trimmed.includes(`"type":"${FILE_TYPE}"`)
}

/**
 * Parse and validate a file-header control frame.
 *
 * @param line - Header frame bytes (without trailing newline).
 * @returns Validated file header payload.
 */
export function parseFileHeader(line: Buffer): FileHeader {
	const parsed = JSON.parse(line.toString('utf8')) as Partial<FileHeader>

	if (parsed.type !== FILE_TYPE) {
		throw new Error('Invalid file header type')
	}

	if (!parsed.name || typeof parsed.name !== 'string') {
		throw new Error('Invalid file header name')
	}

	if (
		typeof parsed.size !== 'number' ||
		!Number.isSafeInteger(parsed.size) ||
		parsed.size < MIN_SIZE
	) {
		throw new Error('Invalid file header size')
	}

	return { name: parsed.name, size: parsed.size, type: FILE_TYPE }
}

/**
 * Parse and validate a completion-ack control frame.
 *
 * @param line - Ack frame bytes (without trailing newline).
 * @returns Parsed ack payload, or `undefined` if frame is unrelated/invalid.
 */
export function parseCompletionAck(line: Buffer): FileCompletionAck | undefined {
	try {
		const parsed = JSON.parse(line.toString('utf8')) as Partial<FileCompletionAck>

		if (parsed.type !== FILE_COMPLETE_TYPE || typeof parsed.ok !== 'boolean') {
			return undefined
		}

		if (parsed.reason !== undefined && typeof parsed.reason !== 'string') {
			return undefined
		}

		return {
			ok: parsed.ok,
			reason: parsed.reason,
			type: FILE_COMPLETE_TYPE,
		}
	} catch {
		return undefined
	}
}

/**
 * Find the end offset of the first newline-delimited frame.
 *
 * @param chunk - Buffered bytes to scan.
 * @returns Index of first newline, or `-1` when no full line exists yet.
 */
export function findHeaderLineEnd(chunk: Buffer): number {
	return chunk.indexOf(NEWLINE)
}

/**
 * Format byte size into a human-readable unit string.
 *
 * @param bytes - Size in bytes.
 * @returns Human-readable size string (for example, `4 B`, `2.4 MB`).
 */
export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < MIN_SIZE) {
		return `0 ${UNIT_LABELS[FIRST_INDEX]}`
	}

	const lastUnitIndex = UNIT_LABELS.length - LAST_INDEX_OFFSET

	let size = bytes
	let unitIndex = FIRST_INDEX

	while (size >= BYTES_PER_KIB && unitIndex < lastUnitIndex) {
		size /= BYTES_PER_KIB
		unitIndex++
	}

	if (unitIndex === FIRST_INDEX) {
		return `${Math.round(size)} ${UNIT_LABELS[unitIndex]}`
	}

	return `${size.toFixed(UNIT_PRECISION)} ${UNIT_LABELS[unitIndex]}`
}
