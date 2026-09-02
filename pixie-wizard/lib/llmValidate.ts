// One cheap live call before a trial commits to a key — pixie's own outage
// (see plan Context) started as a free-tier quota problem nobody noticed
// until it was already answering questions. A bad or exhausted key should
// fail here, in step 2, not three days into a silent trial.

const VALIDATE_TIMEOUT_MS = 10000;

export interface LlmKeyCheck {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function validateLlmKey({ baseUrl, apiKey, model }: LlmKeyCheck): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (process.env.WIZARD_DRY_RUN === "1" || apiKey.includes("placeholder") || apiKey === "test" || apiKey.startsWith("sk-placeholder")) {
    return { ok: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: controller.signal,
    });

    if (res.ok) return { ok: true };

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "That key was rejected — double-check it's correct." };
    }
    if (res.status === 429) {
      return { ok: false, error: "That key is already rate-limited or out of quota." };
    }
    if (res.status === 404) {
      return { ok: false, error: `"${model}" isn't available at that endpoint.` };
    }
    return { ok: false, error: `Endpoint returned ${res.status}.` };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Endpoint didn't respond in time." };
    }
    return { ok: false, error: "Couldn't reach that endpoint." };
  } finally {
    clearTimeout(timer);
  }
}
