

const axios = require("axios");
const https = require("https");
const log = require("./log");

const DEFAULT_TIMEOUT_MS = 25000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function isRetryableError(err) {
  if (err.response) return isRetryableStatus(err.response.status);
  
  return true;
}

function backoffMs(attempt) {
  
  
  return BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 200);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function thinkingFor(model, thinking) {
  return thinking && !/\//.test(model || "") && /deepseek/i.test(model || "") ? thinking : undefined;
}

function stripThinking(text) {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

async function requestCompletion({ baseUrl, apiKey, model, messages, maxTokens, temperature, thinking, timeout }) {
  const usedKey = typeof apiKey === "function" ? apiKey() : apiKey;
  const filteredThinking = thinkingFor(model, thinking);

  try {
    const res = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        max_tokens: maxTokens,
        ...(temperature === undefined ? {} : { temperature }),
        ...(filteredThinking === undefined ? {} : { thinking: filteredThinking }),
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${usedKey}`,
          "Content-Type": "application/json",
        },
        timeout: timeout || DEFAULT_TIMEOUT_MS,
        httpsAgent: keepAliveAgent,
      },
    );

    const rawContent = res.data?.choices?.[0]?.message?.content;
    const cleanContent = stripThinking(rawContent);

    return {
      text: cleanContent,
      finishReason: res.data?.choices?.[0]?.finish_reason,
      usedKey,
    };
  } catch (err) {
    
    
    
    err.usedKey = usedKey;
    throw err;
  }
}

async function completeAttempts(options, scope) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let usedKey;
    try {
      const result = await requestCompletion(options);
      usedKey = result.usedKey;
      if (result.text?.trim() || result.finishReason !== "length") return result;
      log.debug(scope, `empty completion (finish_reason=length), attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
    } catch (err) {
      lastError = err;
      usedKey = err.usedKey;
      if (err.response?.status === 429 && options.onRateLimited) {
        options.onRateLimited(usedKey);
      }
      if (!isRetryableError(err)) throw err;
      const status = err.response?.status || "network";
      log.debug(scope, `request failed (${status}), attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
    }

    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt));
  }

  if (lastError) throw lastError;
  
  return { text: "", finishReason: "length" };
}

function describeError(err) {
  return err.response?.status || err.cause?.code || err.code || "network";
}

async function complete(options, scope = "llm") {
  const { fallback, ...primary } = options;

  try {
    return await completeAttempts(primary, scope);
  } catch (err) {
    if (!fallback) throw err;
    log.warn(scope, `${primary.model || primary.baseUrl} failed (${describeError(err)}) — falling back to ${fallback.model || fallback.baseUrl}`);
    return await complete({ ...primary, ...fallback }, `${scope}-fallback`);
  }
}

function parseSseChunk(buffer) {
  const deltas = [];
  const lines = buffer.split("\n");
  const rest = lines.pop();

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let frame;
    try {
      frame = JSON.parse(payload);
    } catch {
      
      continue;
    }
    const delta = frame?.choices?.[0]?.delta?.content;
    if (delta) deltas.push(delta);
  }

  return { deltas, rest };
}

async function streamCompletion({ baseUrl, apiKey, model, messages, maxTokens, temperature, thinking, timeout }, onDelta) {
  const controller = new AbortController();
  
  
  
  let timer = setTimeout(() => controller.abort(), timeout || DEFAULT_TIMEOUT_MS);
  const clearFirstTokenTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const usedKey = typeof apiKey === "function" ? apiKey() : apiKey;
  const filteredThinking = thinkingFor(model, thinking);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${usedKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        ...(temperature === undefined ? {} : { temperature }),
        ...(filteredThinking === undefined ? {} : { thinking: filteredThinking }),
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`stream failed: HTTP ${res.status} ${body.slice(0, 200)}`);
      err.response = { status: res.status };
      err.usedKey = usedKey;
      throw err;
    }
    if (!res.body) throw new Error("stream failed: no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let stopped = false;
    let insideThink = false;
    let thinkBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { deltas, rest } = parseSseChunk(buffer);
      buffer = rest;

      for (const delta of deltas) {
        clearFirstTokenTimer();

        if (insideThink || delta.includes("<think>") || thinkBuffer.includes("<think>")) {
          insideThink = true;
          thinkBuffer += delta;
          if (thinkBuffer.includes("</think>")) {
            insideThink = false;
            const parts = thinkBuffer.split("</think>");
            const remaining = parts.slice(1).join("</think>");
            thinkBuffer = "";
            if (remaining) {
              text += remaining;
              if (onDelta && onDelta(remaining, text) === false) {
                stopped = true;
                break;
              }
            }
          }
          continue;
        }

        text += delta;
        if (onDelta && onDelta(delta, text) === false) {
          stopped = true;
          break;
        }
      }

      if (stopped) {
        controller.abort();
        break;
      }
    }

    return { text, stopped, usedKey };
  } finally {
    clearFirstTokenTimer();
  }
}

async function streamAttempts(options, onDelta, scope) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let streamed = false;
    const track = (delta, text) => {
      streamed = true;
      return onDelta ? onDelta(delta, text) : undefined;
    };

    try {
      const result = await streamCompletion(options, track);
      if (result.text.trim() || result.stopped) return result;
      log.debug(scope, `empty stream, attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
    } catch (err) {
      lastError = err;
      const usedKey = err.usedKey || (typeof options.apiKey === "function" ? options.apiKey() : options.apiKey);
      if (err.response?.status === 429 && options.onRateLimited) {
        options.onRateLimited(usedKey);
      }
      if (streamed) throw err;
      if (!isRetryableError(err)) throw err;
      const status = err.response?.status || "network";
      log.debug(scope, `stream failed (${status}), attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
    }

    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt));
  }

  if (lastError) throw lastError;
  return { text: "", stopped: false };
}

async function completeStream(options, onDelta, scope = "llm") {
  const { fallback, ...primary } = options;

  
  
  
  let streamedAny = false;
  const track = (delta, text) => {
    streamedAny = true;
    return onDelta ? onDelta(delta, text) : undefined;
  };

  try {
    return await streamAttempts(primary, track, scope);
  } catch (err) {
    if (!fallback || streamedAny) throw err;
    log.warn(scope, `${primary.model || primary.baseUrl} failed (${describeError(err)}) — falling back to ${fallback.model || fallback.baseUrl}`);
    
    
    
    return await completeStream({ ...primary, ...fallback }, track, `${scope}-fallback`);
  }
}

module.exports = {
  complete,
  completeStream,
  requestCompletion,
  streamCompletion,
  parseSseChunk,
  thinkingFor,
  isRetryableStatus,
  isRetryableError,
  keepAliveAgent,
  MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
};
