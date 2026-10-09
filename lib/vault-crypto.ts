import "server-only";
/**
 * Password vault — envelope encryption, SERVER ONLY.
 *
 * Spec (Security): "Envelope encryption, AES-256-GCM: a per-entry data key encrypts the secret;
 * the data key is wrapped by a master key held only in server env (Vercel), never in the database.
 * A database dump alone reveals nothing."
 *
 *   secret  --AES-256-GCM(dataKey, iv, aad=secretAad(entryId, version))-->  ciphertext + tag
 *   dataKey --AES-256-GCM(masterKey, keyIv, aad=wrapAad(masterKeyId))-->   wrappedKey + keyTag
 *
 * - The master key is read from `VAULT_MASTER_KEY` (64 hex or 44 base64 chars = 32 bytes) and
 *   never logged, never returned, never written anywhere. Tests generate a throwaway key.
 * - A fresh 32-byte data key and fresh 12-byte IVs on EVERY encryption (a rotated secret never
 *   shares key material with the version it replaces).
 * - The AAD binds a ciphertext to its entry and version, so a row copied between entries or
 *   versions fails authentication instead of decrypting.
 * - Every failure is a bare `VaultCryptoError(code)`: the message IS the code. No plaintext, no
 *   key bytes, no ciphertext ever enters an error (spec: nothing secret in logs or errors).
 * - `import "server-only"` makes a client import a BUILD failure, not a leak.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const MASTER_KEY_ID = "v1";
const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type VaultCryptoErrorCode = "master_key_missing" | "master_key_invalid" | "decrypt_failed" | "invalid_plaintext";

export class VaultCryptoError extends Error {
  constructor(public readonly code: VaultCryptoErrorCode) {
    super(code);
    this.name = "VaultCryptoError";
  }
}

/** The stored envelope. All fields base64 (text columns on vault_secrets) except the key id. */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  wrappedKey: string;
  keyIv: string;
  keyTag: string;
  masterKeyId: string;
}

/** Binds a ciphertext to one entry and one version. */
export function secretAad(entryId: string, version: number): Buffer {
  return Buffer.from(`vault:${entryId}:${version}`, "utf8");
}

function wrapAad(masterKeyId: string): Buffer {
  return Buffer.from(`vault-key:${masterKeyId}`, "utf8");
}

/** 64 hex chars or 44 base64 chars, both decoding to exactly 32 bytes. Anything else is refused by code. */
export function parseMasterKey(raw: string): Buffer {
  if (typeof raw !== "string") throw new VaultCryptoError("master_key_invalid");
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === KEY_BYTES) return buf;
  }
  throw new VaultCryptoError("master_key_invalid");
}

/** Reads the master key from the server environment. Missing → fails closed. */
export function loadMasterKey(): Buffer {
  const raw = process.env.VAULT_MASTER_KEY;
  if (!raw) throw new VaultCryptoError("master_key_missing");
  return parseMasterKey(raw);
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new VaultCryptoError("master_key_invalid");
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): { iv: Buffer; ciphertext: Buffer; tag: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertext, tag: cipher.getAuthTag() };
}

function open(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encrypts one secret under a fresh data key wrapped by the master key. */
export function encryptSecret(plaintext: string, masterKey: Buffer, aad: Buffer): EncryptedSecret {
  assertKey(masterKey);
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new VaultCryptoError("invalid_plaintext");
  const dataKey = randomBytes(KEY_BYTES);
  try {
    const secret = seal(dataKey, Buffer.from(plaintext, "utf8"), aad);
    const wrap = seal(masterKey, dataKey, wrapAad(MASTER_KEY_ID));
    return {
      ciphertext: secret.ciphertext.toString("base64"),
      iv: secret.iv.toString("base64"),
      tag: secret.tag.toString("base64"),
      wrappedKey: wrap.ciphertext.toString("base64"),
      keyIv: wrap.iv.toString("base64"),
      keyTag: wrap.tag.toString("base64"),
      masterKeyId: MASTER_KEY_ID,
    };
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Decrypts one envelope. Fails closed with the bare code `decrypt_failed` on ANY problem: wrong
 * master key, unknown key id, tampered or moved ciphertext, malformed fields.
 */
export function decryptSecret(enc: EncryptedSecret, masterKey: Buffer, aad: Buffer): string {
  assertKey(masterKey);
  let dataKey: Buffer | null = null;
  try {
    if (enc.masterKeyId !== MASTER_KEY_ID) throw new VaultCryptoError("decrypt_failed");
    const keyIv = Buffer.from(enc.keyIv, "base64");
    const keyTag = Buffer.from(enc.keyTag, "base64");
    const iv = Buffer.from(enc.iv, "base64");
    const tag = Buffer.from(enc.tag, "base64");
    if (keyIv.length !== IV_BYTES || iv.length !== IV_BYTES || keyTag.length !== TAG_BYTES || tag.length !== TAG_BYTES) {
      throw new VaultCryptoError("decrypt_failed");
    }
    dataKey = open(masterKey, keyIv, Buffer.from(enc.wrappedKey, "base64"), keyTag, wrapAad(enc.masterKeyId));
    if (dataKey.length !== KEY_BYTES) throw new VaultCryptoError("decrypt_failed");
    return open(dataKey, iv, Buffer.from(enc.ciphertext, "base64"), tag, aad).toString("utf8");
  } catch {
    // Whatever node:crypto said, the caller learns one thing: it did not decrypt.
    throw new VaultCryptoError("decrypt_failed");
  } finally {
    dataKey?.fill(0);
  }
}
