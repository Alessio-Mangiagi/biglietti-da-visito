import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedBlob {
  iv: Buffer;
  authTag: Buffer;
  data: Buffer;
}

/**
 * AES-256-GCM. `aad` binds the ciphertext to its row (contact id + side) so a blob copied
 * onto another contact fails authentication instead of decrypting.
 */
export function encrypt(key: Buffer, plain: Buffer, aad: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), data };
}

export function decrypt(key: Buffer, blob: EncryptedBlob, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(blob.authTag);
  return Buffer.concat([decipher.update(blob.data), decipher.final()]);
}

/** Random URL-safe token (refresh / reset). Only its SHA-256 is stored. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
