import { test, expect, afterEach } from "bun:test";
import { validateLlmKey } from "./llmValidate";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test("ok response passes validation", async () => {
  global.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  const result = await validateLlmKey({ baseUrl: "https://opencode.ai/zen/v1", apiKey: "k", model: "m" });
  expect(result.ok).toBe(true);
});

test("401 reports a rejected key, not a generic error", async () => {
  global.fetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
  const result = await validateLlmKey({ baseUrl: "https://opencode.ai/zen/v1", apiKey: "bad", model: "m" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/rejected/i);
});

test("429 reports quota exhaustion specifically", async () => {
  global.fetch = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
  const result = await validateLlmKey({ baseUrl: "https://opencode.ai/zen/v1", apiKey: "k", model: "m" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/rate-limited|quota/i);
});

test("network failure is reported, not thrown", async () => {
  global.fetch = (async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as unknown as typeof fetch;
  const result = await validateLlmKey({ baseUrl: "https://nowhere.invalid/v1", apiKey: "k", model: "m" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/couldn't reach/i);
});
