import * as b4a from 'b4a'
import b32 from 'hi-base32'
import sodium from 'sodium-universal'

/** Encode a buffer as a lowercase base32 string without padding. */
export function toBase32(buf: Buffer): string {
	return b32.encode(buf).replace(/=/g, '').toLowerCase()
}

/** Decode a base32 string back into a raw Buffer. */
export function fromBase32(str: string): Buffer {
	return b4a.from(b32.decode.asBytes(str.toUpperCase()))
}

/** Generate cryptographically secure random bytes. */
export function randomBytes(length: number): Buffer {
	const buffer = b4a.alloc(length)
	sodium.randombytes_buf(buffer)
	return buffer
}
