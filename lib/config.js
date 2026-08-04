// Single place where every environment variable is read, defaulted and
// validated. Everything else imports the frozen `config` object instead of
// touching process.env, so a missing value fails loudly at startup with the
// full list of what's absent — rather than degrading into an ERROR_FALLBACK on
// every question, or a console.error nobody reads.
require("dotenv").config();

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const DEFAULT_MODEL = "deepseek-v4-flash-free";
// Both defaults must be names Zen actually serves, since ZEN_BASE_URL is where
// an unconfigured deployment points. This used to be "kr/claude-sonnet-4.5" — a
// name only a local 9Router gateway understands — so the built-in vision default
// was dead on arrival anywhere else. mimo-v2.5-free is the one free Zen model
// that accepts an image.
const DEFAULT_VISION_MODEL = "mimo-v2.5-free";
const DEFAULT_REFRESH_INTERVAL_MIN = 30;

// Where answers land when the whole Zen key pool is out of quota. Same
// endpoint intent already runs on in production.
const NINE_ROUTER_BASE_URL = "http://pixie.railway.internal:20128/v1";
const ANSWER_FALLBACK_MODEL = "gc/gemini-3.1-flash-lite-preview";

const HCAI_BASE_URL = "https://ai.hackclub.com/proxy/v1";
const DEFAULT_HCAI_MODEL = "openrouter/free";
const DEFAULT_HCAI_VISION_MODEL = "xiaomi/mimo-v2-omni";

// Slack credentials are only needed when actually connecting. `--ask` builds
// the corpus and answers on the console, so it requires the model keys only.
const SLACK_VARS = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_HELP_CHANNEL", "SLACK_FAQ_CHANNELS"];
const MODEL_VARS = ["HCAI_API_KEY"];

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

// Tolerates a full ".../chat/completions" URL as well as a bare base, since
// the old README documented OPENCODE_BASE_URL with the path included.
function normalizeBaseUrl(url, fallback) {
  if (!url) return fallback;
  return stripTrailingSlash(url).replace(/\/chat\/completions$/, "");
}

// A key that just returned 429 is known-bad for a while; handing it to the very
// next caller wastes an attempt. Parked briefly instead, so rotation lands on a
// key with quota left.
const KEY_COOLDOWN_MS = 60 * 1000;
const coolingUntil = new Map();

function penalizeZenKey(key, ms = KEY_COOLDOWN_MS) {
  if (!key) return;
  if (ms <= 0) {
    coolingUntil.delete(key);
  } else if (config.zenApiKeys.includes(key)) {
    coolingUntil.set(key, Date.now() + ms);
  }
}

let zenKeyIndex = 0;
function nextZenApiKey() {
  const keys = config.zenApiKeys;
  if (!keys || keys.length === 0) return undefined;

  const now = Date.now();
  // At most one full lap, so an all-cooling pool can't spin.
  for (let i = 0; i < keys.length; i++) {
    const idx = zenKeyIndex % keys.length;
    zenKeyIndex += 1;
    const key = keys[idx];
    if (!(coolingUntil.get(key) > now)) return key;
  }
  // Every key is cooling. Return the one that recovers soonest — a doomed attempt
  // still beats sending no key at all and turning a 429 into a 401.
  return keys.reduce((best, k) => ((coolingUntil.get(k) || 0) < (coolingUntil.get(best) || 0) ? k : best), keys[0]);
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";

function zenStandby(baseUrl, model = DEFAULT_MODEL) {
  if (baseUrl === ZEN_BASE_URL) return null;
  return {
    baseUrl: ZEN_BASE_URL,
    apiKey: () => nextZenApiKey(),
    model: DEFAULT_MODEL,
  };
}

// Fallback standby tier: prefers OpenRouter when configured, then falls back to Zen
function standbyFallback(baseUrl, defaultZenModel = DEFAULT_MODEL) {
  if (baseUrl === OPENROUTER_BASE_URL) return zenStandby(baseUrl, defaultZenModel);
  if (baseUrl === ZEN_BASE_URL && !process.env.OPENROUTER_API_KEY) return null;

  if (process.env.OPENROUTER_API_KEY) {
    return {
      baseUrl: normalizeBaseUrl(process.env.OPENROUTER_BASE_URL, OPENROUTER_BASE_URL),
      apiKey: () => process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      fallback: zenStandby(process.env.OPENROUTER_BASE_URL, defaultZenModel),
    };
  }

  return zenStandby(baseUrl, defaultZenModel);
}

function parseChannels(raw) {
  return (raw || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const faqChannels = parseChannels(process.env.SLACK_FAQ_CHANNELS);
// Who may teach pixie and approve what it learned. Empty means nobody — the
// learning commands refuse rather than falling open, since anything approved
// goes straight into the corpus every answer is grounded in.
const adminUserIds = parseChannels(process.env.PIXIE_ADMIN_USER_IDS);

// Resolved up front so each call site can hand its own URL to zenStandby().
const intentBaseUrl = normalizeBaseUrl(process.env.INTENT_CLASSIFIER_BASE_URL, ZEN_BASE_URL);
const visionBaseUrl = normalizeBaseUrl(
  process.env.PIXIE_VISION_BASE_URL || process.env.OPENCODE_BASE_URL,
  ZEN_BASE_URL,
);

// Ordinal so the pool is deterministic: bare key first, then _2, _3, ... Gaps are
// fine — someone deleting OPENCODE_API_KEY_3 must not renumber the rest.
function zenKeyOrder(name) {
  const m = name.match(/_(\d+)$/);
  return m ? Number(m[1]) : 1;
}

// Every Zen account currently in play. Scanned rather than listed, so adding a
// key is a Railway variable and never a code change.
function collectZenKeys(env = process.env) {
  return Object.keys(env)
    .filter((k) => /^OPENCODE_API_KEY(_\d+)?$/.test(k))
    .sort((a, b) => zenKeyOrder(a) - zenKeyOrder(b))
    .map((k) => (env[k] || "").trim())
    .filter(Boolean);
}

const zenApiKeys = collectZenKeys();

// Same round-robin-plus-cooldown shape as Zen's pool above, kept as an
// independent copy rather than a shared helper: different provider, different
// keys, and one pool cooling down must never block rotation on the other.
const hcaiCoolingUntil = new Map();
let hcaiKeyIndex = 0;

function penalizeHcaiKey(key, ms = KEY_COOLDOWN_MS) {
  if (!key) return;
  if (ms <= 0) {
    hcaiCoolingUntil.delete(key);
  } else if (config.hcaiApiKeys.includes(key)) {
    hcaiCoolingUntil.set(key, Date.now() + ms);
  }
}

function nextHcaiApiKey() {
  const keys = config.hcaiApiKeys;
  if (!keys || keys.length === 0) return undefined;

  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const idx = hcaiKeyIndex % keys.length;
    hcaiKeyIndex += 1;
    const key = keys[idx];
    if (!(hcaiCoolingUntil.get(key) > now)) return key;
  }
  return keys.reduce(
    (best, k) => ((hcaiCoolingUntil.get(k) || 0) < (hcaiCoolingUntil.get(best) || 0) ? k : best),
    keys[0],
  );
}

// Same shape as collectZenKeys — HCAI_API_KEY, HCAI_API_KEY_2, ...
function collectHcaiKeys(env = process.env) {
  return Object.keys(env)
    .filter((k) => /^HCAI_API_KEY(_\d+)?$/.test(k))
    .sort((a, b) => zenKeyOrder(a) - zenKeyOrder(b))
    .map((k) => (env[k] || "").trim())
    .filter(Boolean);
}

const hcaiApiKeys = collectHcaiKeys();

function hcaiTier(model) {
  return {
    apiKey: () => process.env.HCAI_API_KEY,
    baseUrl: HCAI_BASE_URL,
    model,
    onRateLimited: penalizeHcaiKey,
  };
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const DEFAULT_GROQ_INTENT_MODEL = "openai/gpt-oss-20b";

function collectGroqKeys(env = process.env) {
  return Object.keys(env)
    .filter((k) => /^GROQ_API_KEY(_\d+)?$/.test(k))
    .sort((a, b) => zenKeyOrder(a) - zenKeyOrder(b))
    .map((k) => (env[k] || "").trim())
    .filter(Boolean);
}

const groqApiKeys = collectGroqKeys();
const groqCoolingUntil = new Map();
let groqKeyIndex = 0;

function penalizeGroqKey(key, ms = KEY_COOLDOWN_MS) {
  if (!key) return;
  if (ms <= 0) {
    groqCoolingUntil.delete(key);
  } else {
    groqCoolingUntil.set(key, Date.now() + ms);
  }
}

function nextGroqApiKey() {
  const keys = (config && config.groqApiKeys && config.groqApiKeys.length > 0) ? config.groqApiKeys : groqApiKeys;
  if (!keys || keys.length === 0) return process.env.GROQ_API_KEY || undefined;

  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const idx = groqKeyIndex % keys.length;
    groqKeyIndex += 1;
    const key = keys[idx];
    if (!(groqCoolingUntil.get(key) > now)) return key;
  }
  return keys.reduce(
    (best, k) => ((groqCoolingUntil.get(k) || 0) < (groqCoolingUntil.get(best) || 0) ? k : best),
    keys[0],
  );
}

// 9Router/Gemini answers — the operator's preferred primary model, ahead of
// Zen's deepseek-v4-flash-free. Same PIXIE_ANSWER_BASE_URL/PIXIE_MODEL/
// PIXIE_ANSWER_API_KEY vars this tier has always used when it was configured
// as Zen's standby; no Railway variable has to move for this to keep working.
//
// zenStandby() gives it a REAL fallback: Zen's own rotating key pool, used
// only when 9Router itself errors. Before this, primary being pointed
// straight at 9Router made the old answerFallback() (which refused to hand
// back a fallback pointed at wherever primary already was) return null —
// a single 9Router hiccup had nothing to catch it and every question hit
// ERROR_FALLBACK. zenStandby() has no such self-reference problem: Zen is
// never wherever 9Router already is.
//
// Briefly flipped to Zen-primary/9Router-fallback when 9Router's free quota
// was getting rate-limited hard, but that made replies noticeably slower
// overall (Zen's deepseek-v4-flash-free is the slower model day-to-day) —
// reverted back to this.
const DEFAULT_PRIMARY_MODEL = "kr/claude-sonnet-4.5";
const DEFAULT_FALLBACK_MODEL = "ag/gemini-3.6-flash-low";

const nineRouterSecondaryFallbackTier = {
  apiKey: () =>
    process.env.PIXIE_ANSWER_API_KEY || process.env.INTENT_CLASSIFIER_API_KEY || process.env.VISION_API_KEY,
  baseUrl: normalizeBaseUrl(process.env.PIXIE_ANSWER_BASE_URL, NINE_ROUTER_BASE_URL),
  model: process.env.PIXIE_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
  fallback: standbyFallback(normalizeBaseUrl(process.env.PIXIE_ANSWER_BASE_URL, NINE_ROUTER_BASE_URL), DEFAULT_MODEL),
};

const nineRouterAnswerTier = {
  apiKey: () =>
    process.env.PIXIE_ANSWER_API_KEY || process.env.INTENT_CLASSIFIER_API_KEY || process.env.VISION_API_KEY,
  baseUrl: normalizeBaseUrl(process.env.PIXIE_ANSWER_BASE_URL, NINE_ROUTER_BASE_URL),
  model: process.env.PIXIE_MODEL || DEFAULT_PRIMARY_MODEL,
  fallback: process.env.OPENROUTER_API_KEY
    ? {
        apiKey: () => process.env.OPENROUTER_API_KEY,
        baseUrl: normalizeBaseUrl(process.env.OPENROUTER_BASE_URL, OPENROUTER_BASE_URL),
        model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        fallback: nineRouterSecondaryFallbackTier,
      }
    : nineRouterSecondaryFallbackTier,
};

const openRouterAnswerTier = process.env.OPENROUTER_API_KEY
  ? {
      apiKey: () => process.env.OPENROUTER_API_KEY,
      baseUrl: normalizeBaseUrl(process.env.OPENROUTER_BASE_URL, OPENROUTER_BASE_URL),
      model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      fallback: nineRouterAnswerTier,
    }
  : nineRouterAnswerTier;

const nineRouterPingTier = {
  apiKey: () =>
    process.env.PIXIE_PING_API_KEY || process.env.PIXIE_ANSWER_API_KEY || process.env.INTENT_CLASSIFIER_API_KEY || process.env.VISION_API_KEY,
  baseUrl: normalizeBaseUrl(process.env.PIXIE_PING_BASE_URL || process.env.PIXIE_ANSWER_BASE_URL, NINE_ROUTER_BASE_URL),
  model: process.env.PIXIE_PING_MODEL || process.env.PIXIE_MODEL || DEFAULT_PRIMARY_MODEL,
  fallback: openRouterAnswerTier,
};

const config = {
  zenApiKeys,
  hcaiApiKeys,
  groqApiKeys,
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY || null,

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    helpChannel: process.env.SLACK_HELP_CHANNEL,
    faqChannels,
    // The first FAQ channel (#pixl) is the one that gets intent-based
    // auto-replies without needing a mention.
    autoReplyChannel: faqChannels[0] || null,
    // Filled in at startup from auth.test — see resolveBotUserId().
    botUserId: null,
    adminUserIds,
  },

  pingAnswer: hcaiTier(process.env.HCAI_PING_MODEL || process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  helpAnswer: hcaiTier(process.env.HCAI_HELP_MODEL || process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  answer: hcaiTier(process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  intent: hcaiTier(process.env.HCAI_INTENT_MODEL || process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  vision: hcaiTier(process.env.HCAI_VISION_MODEL || DEFAULT_HCAI_VISION_MODEL),

  // Where the weekly report gets posted. Defaults to the help channel, since
  // that's where the people who'd act on it already are. Unset with no help
  // channel either, and the scheduled post stays off — /pixie-report still
  // works, so this is a "where", not an "whether".
  reportChannel: process.env.PIXIE_REPORT_CHANNEL || null,

  refreshIntervalMin: positiveNumber(process.env.REFRESH_INTERVAL_MIN, DEFAULT_REFRESH_INTERVAL_MIN),
  debug: process.env.PIXIE_DEBUG === "1" || process.env.PIXIE_DEBUG === "true",

  // Web server base URL for constructing absolute URLs (screenshot serving, etc.)
  web: {
    baseUrl: process.env.PIXIE_WEB_BASE_URL || `http://localhost:${process.env.PIXIE_WEB_PORT || 4100}`,
  },

  // Emoji pixie reacts with in the help channel when the docs can't answer a
  // question — the marker helpers (and Pixorpheus's ticket flow) look for.
  // Empty disables the handoff. Stored without colons.
  escalateReaction: (process.env.PIXIE_ESCALATE_REACTION || "").replace(/:/g, "").trim() || null,

  // Emojis pixie pre-places on its own answers so voting is one click. Off by
  // default — pixie reacting to itself reads as self-congratulation, and votes
  // from people who add a reaction themselves still count either way. Set
  // PIXIE_FEEDBACK_REACTIONS (e.g. "sparkling_heart") to turn seeding back on.
  // Every name here must be in UP_REACTIONS/DOWN_REACTIONS (lib/handlers.js) or
  // the reaction is decorative and records nothing.
  feedbackReactions: (process.env.PIXIE_FEEDBACK_REACTIONS ?? "")
    .split(",")
    .map((r) => r.replace(/:/g, "").trim())
    .filter(Boolean),
};

// Returns the list of missing variable names for the given mode, so callers
// can report all of them at once instead of one per restart.
function missingVars({ needsSlack }) {
  const required = needsSlack ? [...MODEL_VARS, ...SLACK_VARS] : MODEL_VARS;
  return required.filter((name) => !process.env[name]);
}

function validate({ needsSlack = true } = {}) {
  const missing = missingVars({ needsSlack });
  if (missing.length > 0) {
    throw new Error(
      `missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}\n` +
        `see .env.example — copy it to .env and fill in the blanks`,
    );
  }
  return config;
}

// Slack only tells us our own user ID at runtime. Resolving it once here means
// mention detection can compare against a real ID everywhere, instead of the
// `undefined` it used to build into `<@undefined>`.
async function resolveBotUserId(client) {
  const auth = await client.auth.test();
  config.slack.botUserId = auth.user_id;
  return auth.user_id;
}

// Guard for the commands that mutate what pixie knows. Fails closed on an
// empty allowlist — an unconfigured deployment must not let anyone rewrite the
// corpus.
function isAdmin(userId) {
  return !!userId && config.slack.adminUserIds.includes(userId);
}

module.exports = {
  config,
  validate,
  missingVars,
  isAdmin,
  resolveBotUserId,
  normalizeBaseUrl,
  zenStandby,
  standbyFallback,
  nextZenApiKey,
  collectZenKeys,
  zenKeyOrder,
  penalizeZenKey,
  nextHcaiApiKey,
  collectHcaiKeys,
  penalizeHcaiKey,
  nextGroqApiKey,
  collectGroqKeys,
  penalizeGroqKey,
  ZEN_BASE_URL,
  HCAI_BASE_URL,
  OPENROUTER_BASE_URL,
  GROQ_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_HCAI_MODEL,
  DEFAULT_HCAI_VISION_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_INTENT_MODEL,
  ANSWER_FALLBACK_MODEL,
};
