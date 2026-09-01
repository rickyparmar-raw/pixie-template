import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Envelope encryption for the *_encrypted columns in supabase/schema.sql —
// live Railway tokens and per-trial Slack/LLM keys never touch the database
// as plaintext. AES-256-GCM, one random IV per call; ciphertext is
// iv.authTag.data, all base64url, so it's a single opaque text column.

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.WIZARD_ENCRYPTION_KEY;
  if (!raw) throw new Error("WIZARD_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("WIZARD_ENCRYPTION_KEY must decode to 32 bytes (base64 of an AES-256 key)");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
