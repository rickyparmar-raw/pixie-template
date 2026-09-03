import { test, expect, beforeAll } from "bun:test";
import { encryptSecret, decryptSecret } from "./crypto";

beforeAll(() => {
  process.env.WIZARD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

test("round-trips a secret through encrypt and decrypt", () => {
  const plain = "xoxb-fake-token-123";
  const cipher = encryptSecret(plain);
  expect(cipher).not.toBe(plain);
  expect(decryptSecret(cipher)).toBe(plain);
});

test("two encryptions of the same secret produce different ciphertext", () => {
  const a = encryptSecret("same-input");
  const b = encryptSecret("same-input");
  expect(a).not.toBe(b);
});

test("tampered ciphertext fails to decrypt instead of returning garbage", () => {
  const cipher = encryptSecret("xapp-fake");
  const [iv, tag, data] = cipher.split(".");
  const tampered = [iv, tag, data.slice(0, -2) + "AA"].join(".");
  expect(() => decryptSecret(tampered)).toThrow();
});

test("throws when WIZARD_ENCRYPTION_KEY is missing", () => {
  const saved = process.env.WIZARD_ENCRYPTION_KEY;
  delete process.env.WIZARD_ENCRYPTION_KEY;
  try {
    expect(() => encryptSecret("x")).toThrow();
  } finally {
    process.env.WIZARD_ENCRYPTION_KEY = saved;
  }
});
