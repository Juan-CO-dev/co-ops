/**
 * Password vault — envelope encryption (lib/vault-crypto.ts).
 * A throwaway key is generated here; it is never a real key and never leaves this process.
 * Every failure must be the bare code `decrypt_failed`: no plaintext, no key material in a message.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  MASTER_KEY_ID, decryptSecret, encryptSecret, loadMasterKey, parseMasterKey, secretAad, type EncryptedSecret,
} from "@/lib/vault-crypto";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const AAD = secretAad("11111111-1111-4111-8111-111111111111", 1);
const b64len = (bytes: number) => Buffer.alloc(bytes).toString("base64").length;

describe("the master key", () => {
  afterEach(() => { delete process.env.VAULT_MASTER_KEY; });
  it("parses 64 hex chars or 44 base64 chars into 32 bytes; refuses everything else by code", () => {
    expect(parseMasterKey(KEY.toString("hex")).equals(KEY)).toBe(true);
    expect(parseMasterKey(KEY.toString("base64")).equals(KEY)).toBe(true);
    for (const bad of ["", "abc", KEY.toString("hex").slice(2), randomBytes(16).toString("hex"), "not base64 at all!!!!!!!!!!!!!!!!!!!!!!!!!!!!", randomBytes(33).toString("base64")]) {
      let caught: unknown;
      try { parseMasterKey(bad); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ code: "master_key_invalid" });
      expect(String((caught as Error).message)).not.toContain(bad.slice(0, 8) || "\u0000");
    }
  });
  it("loadMasterKey fails closed when the env is unset or malformed", () => {
    delete process.env.VAULT_MASTER_KEY;
    expect(() => loadMasterKey()).toThrow(expect.objectContaining({ code: "master_key_missing" }));
    process.env.VAULT_MASTER_KEY = "short";
    expect(() => loadMasterKey()).toThrow(expect.objectContaining({ code: "master_key_invalid" }));
    process.env.VAULT_MASTER_KEY = KEY.toString("hex");
    expect(loadMasterKey().equals(KEY)).toBe(true);
  });
});

describe("encrypt / decrypt", () => {
  it.each(["s3cret", "ñandú 🔐 contraseña", "x".repeat(4096), "a"])("round-trips %j", (pt) => {
    const enc = encryptSecret(pt, KEY, AAD);
    expect(decryptSecret(enc, KEY, AAD)).toBe(pt);
  });
  it("produces the envelope shape: base64 fields, 12-byte IVs, 16-byte tags, a 32-byte wrapped data key, key id v1", () => {
    const enc = encryptSecret("s3cret", KEY, AAD);
    expect(enc.masterKeyId).toBe(MASTER_KEY_ID);
    expect(MASTER_KEY_ID).toBe("v1");
    expect(enc.iv).toHaveLength(b64len(12));
    expect(enc.keyIv).toHaveLength(b64len(12));
    expect(enc.tag).toHaveLength(b64len(16));
    expect(enc.keyTag).toHaveLength(b64len(16));
    expect(enc.wrappedKey).toHaveLength(b64len(32));
    for (const v of Object.values(enc)) expect(v).toMatch(/^[A-Za-z0-9+/]+={0,2}$|^v1$/);
    expect(Buffer.from(enc.ciphertext, "base64").toString("latin1")).not.toContain("s3cret");
  });
  it("never reuses a data key or an IV: two encryptions of one plaintext differ everywhere that matters", () => {
    const a = encryptSecret("same", KEY, AAD);
    const b = encryptSecret("same", KEY, AAD);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.wrappedKey).not.toBe(b.wrappedKey);
    expect(a.keyIv).not.toBe(b.keyIv);
  });
  const flip = (b64: string): string => {
    const buf = Buffer.from(b64, "base64");
    buf[0] = (buf[0]! ^ 0x01) & 0xff;
    return buf.toString("base64");
  };
  it.each<[keyof EncryptedSecret]>([["ciphertext"], ["iv"], ["tag"], ["wrappedKey"], ["keyIv"], ["keyTag"]])(
    "fails closed when %s is tampered, with a bare code and no secret in the message", (field) => {
      const enc = encryptSecret("s3cret-CANARY", KEY, AAD);
      const tampered = { ...enc, [field]: flip(enc[field]) };
      let caught: unknown;
      try { decryptSecret(tampered, KEY, AAD); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ code: "decrypt_failed" });
      expect((caught as Error).message).toBe("decrypt_failed");
      expect(JSON.stringify(caught)).not.toContain("CANARY");
    },
  );
  it("is bound to the entry and version (AAD): a ciphertext moved to another entry or version is refused", () => {
    const enc = encryptSecret("s3cret", KEY, AAD);
    expect(() => decryptSecret(enc, KEY, secretAad("22222222-2222-4222-8222-222222222222", 1))).toThrow(expect.objectContaining({ code: "decrypt_failed" }));
    expect(() => decryptSecret(enc, KEY, secretAad("11111111-1111-4111-8111-111111111111", 2))).toThrow(expect.objectContaining({ code: "decrypt_failed" }));
  });
  it("a different master key cannot unwrap the data key; an unknown key id is refused", () => {
    const enc = encryptSecret("s3cret", KEY, AAD);
    expect(() => decryptSecret(enc, OTHER_KEY, AAD)).toThrow(expect.objectContaining({ code: "decrypt_failed" }));
    expect(() => decryptSecret({ ...enc, masterKeyId: "v9" }, KEY, AAD)).toThrow(expect.objectContaining({ code: "decrypt_failed" }));
  });
  it("refuses an empty plaintext and a wrong-length key before touching the cipher", () => {
    expect(() => encryptSecret("", KEY, AAD)).toThrow(expect.objectContaining({ code: "invalid_plaintext" }));
    expect(() => encryptSecret("x", randomBytes(16), AAD)).toThrow(expect.objectContaining({ code: "master_key_invalid" }));
  });
});
