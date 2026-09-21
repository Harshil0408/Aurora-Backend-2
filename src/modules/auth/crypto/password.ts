import {
  hash as argonHash,
  verify as argonVerify,
  type Options as ArgonOptions,
} from '@node-rs/argon2';

// OWASP-recommended baseline for interactive logins (RFC 9106 first
// recommendation: m=19 MiB, t=2, p=1). ~100-250ms per hash on server
// hardware — slow enough to hurt attackers, fast enough for login UX.
//
// NOTE: @node-rs/argon2 exposes Algorithm as an ambient const enum, which
// is inaccessible under verbatimModuleSyntax, so the algorithm is given as
// its numeric id (0=Argon2d, 1=Argon2i, 2=Argon2id per the Argon2 spec).
const OPTIONS: ArgonOptions = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Argon2id hash for passwords AND single-use recovery codes. */
export async function hashSecret(plaintext: string): Promise<string> {
  return argonHash(plaintext, { ...OPTIONS });
}

/**
 * Constant-structure verify: returns false (never throws) for wrong
 * secrets AND for malformed stored hashes, so callers can't leak
 * hash-corruption state through error paths.
 */
export async function verifySecret(storedHash: string, candidate: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, candidate);
  } catch {
    return false;
  }
}
