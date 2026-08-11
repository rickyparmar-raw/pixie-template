const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBaseUrl,
  missingVars,
  isAdmin,
  config,
  zenStandby,
  nextZenApiKey,
  collectZenKeys,
  penalizeZenKey,
  nextHcaiApiKey,
  collectHcaiKeys,
  penalizeHcaiKey,
  nextGroqApiKey,
  collectGroqKeys,
  penalizeGroqKey,
  ZEN_BASE_URL,
  HCAI_BASE_URL,
  GROQ_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_GROQ_MODEL,
} = require("./config");

// The allowlist gates everything that rewrites the corpus, so an unconfigured
// deployment must fail closed rather than letting anyone teach pixie.
test("isAdmin denies everyone when no allowlist is configured", () => {
  const saved = config.slack.adminUserIds;
  config.slack.adminUserIds = [];
  try {
    assert.equal(isAdmin("U1"), false);
    assert.equal(isAdmin(undefined), false);
  } finally {
    config.slack.adminUserIds = saved;
  }
});

test("isAdmin allows only listed users", () => {
  const saved = config.slack.adminUserIds;
  config.slack.adminUserIds = ["U1", "U2"];
  try {
    assert.equal(isAdmin("U1"), true);
    assert.equal(isAdmin("U2"), true);
    assert.equal(isAdmin("U3"), false);
    assert.equal(isAdmin(""), false);
  } finally {
    config.slack.adminUserIds = saved;
  }
});

// Retrying Zen after Zen just failed buys nothing but latency, so the standby
// only exists for call sites actually pointed somewhere else.
test("zenStandby is null when the call site already targets Zen", () => {
  assert.equal(zenStandby(ZEN_BASE_URL, "any-model"), null);
});

test("zenStandby names Zen and the given model for a self-hosted gateway", () => {
  const standby = zenStandby("http://9router.railway.internal:20128/v1", "deepseek-v4-flash-free");
  assert.equal(standby.baseUrl, ZEN_BASE_URL);
  assert.equal(standby.model, "deepseek-v4-flash-free");
});

// Every built-in default has to be a name Zen actually serves, since Zen is
// where an unconfigured deployment points. "kr/claude-sonnet-4.5" was baked in
// as the vision default and only ever resolved on a local 9Router — a provider
// prefix is a sign the name came from a gateway's catalogue, not Zen's.
test("the built-in model defaults are names Zen serves", () => {
  assert.ok(!DEFAULT_MODEL.includes("/"), `${DEFAULT_MODEL} is gateway-only`);
  assert.ok(!DEFAULT_VISION_MODEL.includes("/"), `${DEFAULT_VISION_MODEL} is gateway-only`);
});

test("normalizeBaseUrl falls back when unset", () => {
  assert.equal(normalizeBaseUrl(undefined, ZEN_BASE_URL), ZEN_BASE_URL);
  assert.equal(normalizeBaseUrl("", ZEN_BASE_URL), ZEN_BASE_URL);
});

test("normalizeBaseUrl strips a trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://example.com/v1/", ZEN_BASE_URL), "https://example.com/v1");
});

// The old README documented OPENCODE_BASE_URL with the full path included, so
// existing .env files in the wild have it that way.
test("normalizeBaseUrl tolerates a full chat/completions URL", () => {
  assert.equal(
    normalizeBaseUrl("https://opencode.ai/zen/v1/chat/completions", ZEN_BASE_URL),
    "https://opencode.ai/zen/v1",
  );
});

test("missingVars reports every absent required var at once", () => {
  const saved = { ...process.env };
  delete process.env.HCAI_API_KEY;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.SLACK_HELP_CHANNEL;
  delete process.env.SLACK_FAQ_CHANNELS;

  try {
    const missing = missingVars({ needsSlack: true });
    assert.ok(missing.includes("HCAI_API_KEY"));
    assert.ok(missing.includes("SLACK_BOT_TOKEN"));
    assert.equal(missing.length, 5);
  } finally {
    Object.assign(process.env, saved);
  }
});

// `--ask` runs the whole pipeline offline, so requiring Slack tokens there
// would block the one workflow that needs no Slack at all.
/* --------------------------------------------------------- zen key pool -- */

test("collectZenKeys finds bare and numbered keys in order, filtering blanks", () => {
  const mockEnv = {
    OPENCODE_API_KEY_3: "key-3",
    OPENCODE_API_KEY: "key-1",
    OPENCODE_API_KEY_2: "key-2",
    OPENCODE_API_KEY_7: " key-7 ",
    OPENCODE_API_KEY_4: "",
    OTHER_VAR: "ignore",
  };
  const keys = collectZenKeys(mockEnv);
  assert.deepEqual(keys, ["key-1", "key-2", "key-3", "key-7"]);
});

test("nextZenApiKey skips a penalized key", () => {
  const saved = config.zenApiKeys;
  config.zenApiKeys = ["key-a", "key-b"];
  try {
    penalizeZenKey("key-a", 10000);
    assert.equal(nextZenApiKey(), "key-b");
    assert.equal(nextZenApiKey(), "key-b");
  } finally {
    config.zenApiKeys = saved;
    penalizeZenKey("key-a", 0);
  }
});

test("an all-cooling pool still returns a key rather than undefined", () => {
  const saved = config.zenApiKeys;
  config.zenApiKeys = ["key-a", "key-b"];
  try {
    penalizeZenKey("key-a", 5000);
    penalizeZenKey("key-b", 10000);
    assert.equal(nextZenApiKey(), "key-a");
  } finally {
    config.zenApiKeys = saved;
    penalizeZenKey("key-a", 0);
    penalizeZenKey("key-b", 0);
  }
});

test("penalizeZenKey ignores non-pool keys", () => {
  const saved = config.zenApiKeys;
  config.zenApiKeys = ["key-a"];
  try {
    penalizeZenKey("9router-key", 10000);
    assert.equal(nextZenApiKey(), "key-a");
  } finally {
    config.zenApiKeys = saved;
  }
});

// Order-independent on purpose: other test files also read config.answer.apiKey
// (the calling code builds that options object even with llm.complete stubbed),
// which silently advances the shared rotation counter across the whole suite.
// These assert relative rotation behaviour, never an absolute starting key.
test("nextZenApiKey returns undefined with no keys configured", () => {
  const saved = config.zenApiKeys;
  config.zenApiKeys = [];
  try {
    assert.equal(nextZenApiKey(), undefined);
  } finally {
    config.zenApiKeys = saved;
  }
});

test("nextZenApiKey always returns the only configured key", () => {
  const saved = config.zenApiKeys;
  config.zenApiKeys = ["solo-key"];
  try {
    assert.equal(nextZenApiKey(), "solo-key");
    assert.equal(nextZenApiKey(), "solo-key");
    assert.equal(nextZenApiKey(), "solo-key");
  } finally {
    config.zenApiKeys = saved;
  }
});

test("nextZenApiKey round-robins across every configured key", () => {
  const saved = config.zenApiKeys;
  config.zenApiKeys = ["key-a", "key-b"];
  try {
    const first = nextZenApiKey();
    const second = nextZenApiKey();
    assert.notEqual(first, second);
    assert.ok(["key-a", "key-b"].includes(first));
    assert.ok(["key-a", "key-b"].includes(second));
  } finally {
    config.zenApiKeys = saved;
  }
});

// config.answer is 9Router/Gemini primary, so its own apiKey must NOT touch
// the Zen pool — only config.answer.fallback (a zenStandby()) should. Mixing
// the two would mean a 9Router-key rate limit incorrectly cools down a Zen
// key, or vice versa.
test("config.answer.apiKey uses the sole HCAI key instead of the Zen pool", () => {
  const saved = config.zenApiKeys;
  const savedHcaiKey = process.env.HCAI_API_KEY;
  config.zenApiKeys = ["key-a", "key-b"];
  process.env.HCAI_API_KEY = "hc-only";
  try {
    const getApiKey = (fnOrStr) => (typeof fnOrStr === "function" ? fnOrStr() : fnOrStr);
    assert.equal(getApiKey(config.answer.apiKey), "hc-only");
  } finally {
    config.zenApiKeys = saved;
    if (savedHcaiKey === undefined) delete process.env.HCAI_API_KEY;
    else process.env.HCAI_API_KEY = savedHcaiKey;
  }
});

// config.answer.fallback and a zenStandby fallback elsewhere (e.g. intent)
// both hit real Zen, so both must draw from the same pool rather than each
// keeping their own rotation — otherwise one call site could keep hammering
// an exhausted key while the other's copy of the pool sat on the healthy one.
test("config.answer has no alternate provider fallback", () => {
  assert.equal(config.answer.fallback, undefined);
});

// The whole point of preferring 9Router over Zen is lost if a 9Router hiccup
// has nothing to fall back to — this was the actual bug that took the bot
// down (see git history: PIXIE_ANSWER_BASE_URL pinned to 9Router left
// config.answer.fallback null because the old fallback logic refused to
// hand back a fallback pointed at wherever primary already was).
test("all model paths use the single HCAI provider without a fallback", () => {
  for (const tier of [config.pingAnswer, config.helpAnswer, config.answer, config.intent, config.vision]) {
    assert.equal(tier.baseUrl, HCAI_BASE_URL);
    assert.equal(tier.fallback, undefined);
  }
});

/* -------------------------------------------------------------- hcai pool -- */

test("collectHcaiKeys finds bare and numbered keys in order, filtering blanks", () => {
  const mockEnv = {
    HCAI_API_KEY_2: "hc-2",
    HCAI_API_KEY: "hc-1",
    HCAI_API_KEY_5: " hc-5 ",
    HCAI_API_KEY_3: "",
    OPENCODE_API_KEY: "ignore",
  };
  const keys = collectHcaiKeys(mockEnv);
  assert.deepEqual(keys, ["hc-1", "hc-2", "hc-5"]);
});

test("nextHcaiApiKey round-robins independently of the Zen pool", () => {
  const savedHcai = config.hcaiApiKeys;
  const savedZen = config.zenApiKeys;
  config.hcaiApiKeys = ["hc-a", "hc-b"];
  config.zenApiKeys = ["zen-a"];
  try {
    const first = nextHcaiApiKey();
    const second = nextHcaiApiKey();
    assert.notEqual(first, second);
    assert.ok(["hc-a", "hc-b"].includes(first));
    // Drawing from the HCAI pool must never advance or return a Zen key.
    assert.equal(nextZenApiKey(), "zen-a");
  } finally {
    config.hcaiApiKeys = savedHcai;
    config.zenApiKeys = savedZen;
  }
});

test("penalizeHcaiKey skips a cooling key without touching the Zen pool's cooldown", () => {
  const savedHcai = config.hcaiApiKeys;
  const savedZen = config.zenApiKeys;
  config.hcaiApiKeys = ["hc-a", "hc-b"];
  config.zenApiKeys = ["hc-a"]; // same string, different pool — must cool independently
  try {
    penalizeHcaiKey("hc-a", 10000);
    assert.equal(nextHcaiApiKey(), "hc-b");
    assert.equal(nextHcaiApiKey(), "hc-b");
    // The Zen pool's own copy of "hc-a" was never penalized.
    assert.equal(nextZenApiKey(), "hc-a");
  } finally {
    config.hcaiApiKeys = savedHcai;
    config.zenApiKeys = savedZen;
    penalizeHcaiKey("hc-a", 0);
  }
});

test("HCAI_BASE_URL is a distinct endpoint from Zen's", () => {
  assert.notEqual(HCAI_BASE_URL, ZEN_BASE_URL);
  assert.equal(HCAI_BASE_URL, "https://ai.hackclub.com/proxy/v1");
});

test("collectGroqKeys finds bare and numbered keys in order, filtering blanks", () => {
  const mockEnv = {
    GROQ_API_KEY_2: "gsk-2",
    GROQ_API_KEY: "gsk-1",
    GROQ_API_KEY_5: " gsk-5 ",
    GROQ_API_KEY_3: "",
    OPENCODE_API_KEY: "ignore",
  };
  const keys = collectGroqKeys(mockEnv);
  assert.deepEqual(keys, ["gsk-1", "gsk-2", "gsk-5"]);
});

test("nextGroqApiKey round-robins independently of the Zen pool", () => {
  const savedGroq = config.groqApiKeys;
  const savedZen = config.zenApiKeys;
  config.groqApiKeys = ["groq-a", "groq-b"];
  config.zenApiKeys = ["zen-a"];
  try {
    const first = nextGroqApiKey();
    const second = nextGroqApiKey();
    assert.notEqual(first, second);
    assert.ok(["groq-a", "groq-b"].includes(first));
    assert.equal(nextZenApiKey(), "zen-a");
  } finally {
    config.groqApiKeys = savedGroq;
    config.zenApiKeys = savedZen;
  }
});

test("penalizeGroqKey skips a cooling key without touching other pools", () => {
  const savedGroq = config.groqApiKeys;
  config.groqApiKeys = ["groq-a", "groq-b"];
  try {
    penalizeGroqKey("groq-a", 10000);
    assert.equal(nextGroqApiKey(), "groq-b");
    assert.equal(nextGroqApiKey(), "groq-b");
  } finally {
    config.groqApiKeys = savedGroq;
    penalizeGroqKey("groq-a", 0);
  }
});

test("GROQ_BASE_URL is pointed at Groq OpenAI-compatible endpoint", () => {
  assert.equal(GROQ_BASE_URL, "https://api.groq.com/openai/v1");
});

test("missingVars ignores Slack vars when Slack is not needed", () => {
  const saved = { ...process.env };
  process.env.HCAI_API_KEY = "test-key";
  delete process.env.SLACK_BOT_TOKEN;

  try {
    assert.deepEqual(missingVars({ needsSlack: false }), []);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("pingAnswer defaults to the HCAI model", () => {
  assert.equal(config.pingAnswer.model, config.answer.model);
  assert.equal(config.pingAnswer.baseUrl, HCAI_BASE_URL);
});
