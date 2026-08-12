const { test } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const llm = require("./llm");
const { isRetryableStatus, isRetryableError } = llm;

async function withAxiosPost(impl, fn) {
  const original = axios.post;
  axios.post = impl;
  try {
    return await fn();
  } finally {
    axios.post = original;
  }
}

test("isRetryableStatus covers throttling and server errors", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(status), true, String(status));
  }
});

// Retrying a bad key or a malformed request just makes the failure slower.
test("isRetryableStatus rejects client errors we cannot recover from", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableStatus(status), false, String(status));
  }
});

test("isRetryableError treats a missing response as retryable", () => {
  assert.equal(isRetryableError(new Error("socket hang up")), true);
  assert.equal(isRetryableError({ code: "ECONNABORTED" }), true);
});

test("isRetryableError defers to the status when there is a response", () => {
  assert.equal(isRetryableError({ response: { status: 429 } }), true);
  assert.equal(isRetryableError({ response: { status: 401 } }), false);
});

/* ------------------------------------------------------------ SSE parsing -- */

const sse = (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n`;

test("parseSseChunk pulls the content deltas out of complete lines", () => {
  const { deltas, rest } = llm.parseSseChunk(`${sse("he")}${sse("llo")}`);
  assert.deepEqual(deltas, ["he", "llo"]);
  assert.equal(rest, "");
});

// Frames arrive split across network chunks, so half a line has to survive
// until the rest of it shows up.
test("parseSseChunk holds back a partial line", () => {
  const whole = sse("hi");
  const cut = whole.length - 4;

  const first = llm.parseSseChunk(whole.slice(0, cut));
  assert.deepEqual(first.deltas, []);

  const second = llm.parseSseChunk(first.rest + whole.slice(cut));
  assert.deepEqual(second.deltas, ["hi"]);
});

test("parseSseChunk ignores [DONE], keepalives and unparseable frames", () => {
  const { deltas } = llm.parseSseChunk('data: [DONE]\n\ndata: {not json}\n: keepalive\ndata: {"choices":[{}]}\n');
  assert.deepEqual(deltas, []);
});

/* -------------------------------------------------------------- streaming -- */

// Stands in for the endpoint: hands the frames back as one readable stream.
function fakeFetch(chunks, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => "boom",
    body: {
      getReader() {
        let i = 0;
        return {
          read: async () =>
            i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true },
        };
      },
    },
  });
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const REQUEST = { baseUrl: "http://x", apiKey: "k", model: "m", messages: [] };

test("completeStream assembles the deltas and reports each one as it lands", async () => {
  const seen = [];
  const result = await withFetch(fakeFetch([sse("one "), sse("two"), "data: [DONE]\n"]), () =>
    llm.completeStream(REQUEST, (delta, text) => seen.push([delta, text])),
  );

  assert.equal(result.text, "one two");
  assert.deepEqual(seen, [
    ["one ", "one "],
    ["two", "one two"],
  ]);
});

// The SILENT gate has to stop a stream the moment it knows there is nothing to
// say, rather than paying for the rest of a completion it throws away.
test("completeStream stops when the callback returns false", async () => {
  const seen = [];
  const result = await withFetch(fakeFetch([sse("SILENT"), sse(" and more")]), () =>
    llm.completeStream(REQUEST, (delta) => {
      seen.push(delta);
      return false;
    }),
  );

  assert.deepEqual(seen, ["SILENT"]);
  assert.equal(result.stopped, true);
  assert.equal(result.text, "SILENT");
});

test("completeStream retries an attempt that streamed nothing", async () => {
  let attempts = 0;
  const flaky = async (...args) => {
    attempts += 1;
    if (attempts === 1) {
      const err = new Error("503");
      err.response = { status: 503 };
      throw err;
    }
    return fakeFetch([sse("recovered")])(...args);
  };

  const result = await withFetch(flaky, () => llm.completeStream(REQUEST, () => {}));

  assert.equal(attempts, 2);
  assert.equal(result.text, "recovered");
});

// Once a fragment is on screen a retry would rewrite the reply in front of
// whoever is reading it, so a mid-stream failure has to surface instead.
test("completeStream does not retry once text has been streamed", async () => {
  let attempts = 0;
  const breaksMidStream = async () => {
    attempts += 1;
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          let first = true;
          return {
            read: async () => {
              if (!first) throw new Error("socket hang up");
              first = false;
              return { done: false, value: new TextEncoder().encode(sse("half an ans")) };
            },
          };
        },
      },
    };
  };

  await withFetch(breaksMidStream, async () => {
    await assert.rejects(() => llm.completeStream(REQUEST, () => {}), /socket hang up/);
  });
  assert.equal(attempts, 1);
});

test("completeStream throws a non-retryable status straight away", async () => {
  let attempts = 0;
  const unauthorized = async (...args) => {
    attempts += 1;
    return fakeFetch([], { status: 401 })(...args);
  };

  await withFetch(unauthorized, async () => {
    await assert.rejects(() => llm.completeStream(REQUEST, () => {}), /HTTP 401/);
  });
  assert.equal(attempts, 1);
});

/* -------------------------------------------------------------- fallback -- */

// A self-hosted gateway going down used to throw all the way up to
// classifyIntent, which returns null on error — and HELP_ONLY reads null as
// "nobody was asking", so pixie went silent everywhere with nothing in the logs
// naming the cause. The standby turns that outage into a worse answer instead.
const STANDBY = { baseUrl: "http://standby", apiKey: "k2", model: "m2" };

// Routes each request by base URL so a test can kill one endpoint and keep the
// other alive.
function byBaseUrl(routes) {
  return async (url, init) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw Object.assign(new Error("ECONNREFUSED"), { cause: { code: "ECONNREFUSED" } });
    return routes[key](url, init);
  };
}

test("completeStream falls back to the standby when the primary is unreachable", async () => {
  const seenUrls = [];
  const fetchImpl = byBaseUrl({
    "http://standby": (...args) => {
      seenUrls.push("standby");
      return fakeFetch([sse("from the standby"), "data: [DONE]\n"])(...args);
    },
  });

  const result = await withFetch(fetchImpl, () =>
    llm.completeStream({ ...REQUEST, baseUrl: "http://dead", fallback: STANDBY }, () => {}),
  );

  assert.equal(result.text, "from the standby");
  assert.deepEqual(seenUrls, ["standby"]);
});

// The reply is already on screen at this point. Switching models would rewrite
// it mid-sentence in front of whoever is reading it.
test("completeStream does not fall back once text has reached the reader", async () => {
  let standbyCalls = 0;
  const fetchImpl = byBaseUrl({
    "http://flaky": async () => ({
      ok: true,
      status: 200,
      body: {
        getReader() {
          let sent = false;
          return {
            read: async () => {
              if (sent) throw new Error("socket hang up");
              sent = true;
              return { done: false, value: new TextEncoder().encode(sse("half an ")) };
            },
          };
        },
      },
    }),
    "http://standby": (...args) => {
      standbyCalls += 1;
      return fakeFetch([sse("whole other answer")])(...args);
    },
  });

  await withFetch(fetchImpl, async () => {
    await assert.rejects(
      () => llm.completeStream({ ...REQUEST, baseUrl: "http://flaky", fallback: STANDBY }, () => {}),
      /socket hang up/,
    );
  });
  assert.equal(standbyCalls, 0, "a visible reply must never be rewritten by the standby");
});

test("thinkingFor only returns thinking object for deepseek models", () => {
  const thinkingObj = { type: "disabled" };
  assert.deepEqual(llm.thinkingFor("deepseek-v4-flash-free", thinkingObj), thinkingObj);
  assert.deepEqual(llm.thinkingFor("deepseek-chat", thinkingObj), thinkingObj);
  assert.equal(llm.thinkingFor("gc/gemini-3.1-flash-lite-preview", thinkingObj), undefined);
  assert.equal(llm.thinkingFor("kr/claude-sonnet-4.5", thinkingObj), undefined);
});

// Regression: HCAI's catalogue names DeepSeek "deepseek/deepseek-v4-flash-latest"
// — a bare substring match on "deepseek" wrongly caught this too and sent
// `thinking` to a gateway that doesn't understand it, which HCAI's endpoint
// rejected with a 400 on every single request.
test("thinkingFor does not match a deepseek model behind someone else's gateway", () => {
  assert.equal(llm.thinkingFor("deepseek/deepseek-v4-flash-latest", { type: "disabled" }), undefined);
});

test("completeStream calls apiKey function per attempt and passes key to onRateLimited on 429", async () => {
  let keysCalled = [];
  const apiKeyFn = () => {
    const k = `key-${keysCalled.length + 1}`;
    keysCalled.push(k);
    return k;
  };

  let rateLimitedKey = null;
  const onRateLimited = (key) => {
    rateLimitedKey = key;
  };

  let attempts = 0;
  const rateLimitFetch = async (url, options) => {
    attempts++;
    if (attempts === 1) {
      return fakeFetch([], { status: 429 })();
    }
    return fakeFetch([sse("success")])();
  };

  const result = await withFetch(rateLimitFetch, () =>
    llm.completeStream({ ...REQUEST, apiKey: apiKeyFn, onRateLimited }, () => {}),
  );

  assert.equal(result.text, "success");
  assert.equal(attempts, 2);
  assert.equal(rateLimitedKey, "key-1");
  assert.deepEqual(keysCalled, ["key-1", "key-2"]);
});

// Regression for the non-streaming path: requestCompletion's catch used to have
// no way to attribute a failure to the key that caused it, so the retry loop's
// catch called apiKey() again on error — advancing rotation and penalizing
// whatever key came back next, never the one that actually 429'd. Tested at
// requestCompletion directly (not complete()), which lib/learn.test.js
// permanently monkeypatches at require time with no restore — a pre-existing
// cross-file pollution that only bites whichever test is first to call the
// real llm.complete in a full-suite run.
test("requestCompletion attaches the key it used to a thrown error", async () => {
  const apiKeyFn = () => "key-1";
  const err429 = Object.assign(new Error("Request failed with status code 429"), { response: { status: 429 } });

  await withAxiosPost(
    async () => {
      throw err429;
    },
    async () => {
      await assert.rejects(() => llm.requestCompletion({ ...REQUEST, apiKey: apiKeyFn }), (thrown) => {
        assert.equal(thrown, err429);
        assert.equal(thrown.usedKey, "key-1");
        return true;
      });
    },
  );
});

/* -------------------------------------------------------- fallback chains -- */

// A fallback can carry its own `.fallback` (e.g. HCAI -> Zen -> 9Router), so a
// dead primary and a dead first standby must still reach the third tier
// instead of giving up after one hop. Non-retryable status on the first two
// tiers so each fails on its first attempt rather than burning backoff sleeps.
test("complete falls through a two-hop fallback chain to reach a working tier", async () => {
  const seenUrls = [];
  await withAxiosPost(async (url) => {
    seenUrls.push(url);
    if (url.startsWith("http://hop2")) {
      return { data: { choices: [{ message: { content: "from hop2" }, finish_reason: "stop" }] } };
    }
    const err = new Error("bad request");
    err.response = { status: 400 };
    throw err;
  }, async () => {
    const result = await llm.complete({
      ...REQUEST,
      baseUrl: "http://primary",
      fallback: {
        baseUrl: "http://hop1",
        apiKey: "k1",
        model: "m1",
        fallback: { baseUrl: "http://hop2", apiKey: "k2", model: "m2" },
      },
    });
    assert.equal(result.text, "from hop2");
  });

  assert.ok(seenUrls.some((u) => u.startsWith("http://primary")));
  assert.ok(seenUrls.some((u) => u.startsWith("http://hop1")));
  assert.ok(seenUrls.some((u) => u.startsWith("http://hop2")));
});

test("completeStream falls through a two-hop fallback chain to reach a working tier", async () => {
  // Non-retryable status on the first two tiers, same reasoning as the
  // complete() version above — one attempt per dead tier, not three.
  const fetchImpl = byBaseUrl({
    "http://primary": (...args) => fakeFetch([], { status: 400 })(...args),
    "http://hop1": (...args) => fakeFetch([], { status: 400 })(...args),
    "http://standby": (...args) => fakeFetch([sse("from hop2"), "data: [DONE]\n"])(...args),
  });

  const result = await withFetch(fetchImpl, () =>
    llm.completeStream(
      {
        ...REQUEST,
        baseUrl: "http://primary",
        fallback: { baseUrl: "http://hop1", apiKey: "k1", model: "m1", fallback: STANDBY },
      },
      () => {},
    ),
  );

  // http://standby is STANDBY's baseUrl — the chain's third tier.
  assert.equal(result.text, "from hop2");
});

test("completeStream rethrows when no standby is configured", async () => {
  await withFetch(byBaseUrl({}), async () => {
    await assert.rejects(
      () => llm.completeStream({ ...REQUEST, baseUrl: "http://dead" }, () => {}),
      /ECONNREFUSED/,
    );
  });
});
