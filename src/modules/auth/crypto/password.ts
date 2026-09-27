import {
  hash as argonHash,
  verify as argonVerify,
  type Options as ArgonOptions,
} from '@node-rs/argon2';

const OPTIONS: ArgonOptions = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashSecret(plaintext: string): Promise<string> {
  return argonHash(plaintext, { ...OPTIONS });
}

export async function verifySecret(storedHash: string, candidate: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, candidate);
  } catch {
    return false;
  }
}
