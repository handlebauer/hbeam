/**
 * Hbeam — End-to-end encrypted 1-to-1 pipe over HyperDHT.
 *
 * @example
 * ```ts
 * import { Beam } from "./src/index.ts";
 *
 * const beam = new Beam();          // Server mode (generates key)
 * console.log(beam.key);            // Share with remote peer
 *
 * const peer = new Beam(beam.key);  // Client mode (connects)
 * ```
 *
 * @module
 */

export { Beam } from './beam.ts'

export type {
	BeamEvents,
	BeamOptions,
	ConnectionInfo,
	EncryptedSocket,
	HyperDHTNode,
	HyperDHTServer,
	KeyPair,
	StreamCallback,
} from './types.ts'

export { fromBase32, randomBytes, toBase32 } from './lib/encoding.ts'
