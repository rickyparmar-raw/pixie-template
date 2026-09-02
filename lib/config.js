

require("dotenv").config();

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const DEFAULT_MODEL = "deepseek-v4-flash-free";

const DEFAULT_VISION_MODEL = "mimo-v2.5-free";
const DEFAULT_REFRESH_INTERVAL_MIN = 30;

const NINE_ROUTER_BASE_URL = "http://pixie.railway.internal:20128/v1";
const ANSWER_FALLBACK_MODEL = "gc/gemini-3.1-flash-lite-preview";

const HCAI_BASE_URL = "https://ai.hackclub.com/proxy/v1";
const DEFAULT_HCAI_MODEL = "openrouter/free";
const DEFAULT_HCAI_VISION_MODEL = "xiaomi/mimo-v2-omni";

const SLACK_VARS = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_HELP_CHANNEL", "SLACK_FAQ_CHANNELS"];
const MODEL_VARS = ["HCAI_API_KEY"];

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

function normalizeBaseUrl(url, fallback) {
  if (!url) return fallback;
  return stripTrailingSlash(url).replace(/\/chat\/completions$/, "");
}

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
  
  for (let i = 0; i < keys.length; i++) {
    const idx = zenKeyIndex % keys.length;
    zenKeyIndex += 1;
    const key = keys[idx];
    if (!(coolingUntil.get(key) > now)) return key;
  }
  
  
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

const adminUserIds = parseChannels(process.env.PIXIE_ADMIN_USER_IDS);

const intentBaseUrl = normalizeBaseUrl(process.env.INTENT_CLASSIFIER_BASE_URL, ZEN_BASE_URL);
const visionBaseUrl = normalizeBaseUrl(
  process.env.PIXIE_VISION_BASE_URL || process.env.OPENCODE_BASE_URL,
  ZEN_BASE_URL,
);

function zenKeyOrder(name) {
  const m = name.match(/_(\d+)$/);
  return m ? Number(m[1]) : 1;
}

function collectZenKeys(env = process.env) {
  return Object.keys(env)
    .filter((k) => /^OPENCODE_API_KEY(_\d+)?$/.test(k))
    .sort((a, b) => zenKeyOrder(a) - zenKeyOrder(b))
    .map((k) => (env[k] || "").trim())
    .filter(Boolean);
}

const zenApiKeys = collectZenKeys();

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
    
    
    autoReplyChannel: faqChannels[0] || null,
    
    botUserId: null,
    adminUserIds,
  },

  pingAnswer: hcaiTier(process.env.HCAI_PING_MODEL || process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  helpAnswer: hcaiTier(process.env.HCAI_HELP_MODEL || process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  answer: hcaiTier(process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  intent: hcaiTier(process.env.HCAI_INTENT_MODEL || process.env.HCAI_MODEL || DEFAULT_HCAI_MODEL),
  vision: hcaiTier(process.env.HCAI_VISION_MODEL || DEFAULT_HCAI_VISION_MODEL),

  
  
  
  
  reportChannel: process.env.PIXIE_REPORT_CHANNEL || null,

  refreshIntervalMin: positiveNumber(process.env.REFRESH_INTERVAL_MIN, DEFAULT_REFRESH_INTERVAL_MIN),
  debug: process.env.PIXIE_DEBUG === "1" || process.env.PIXIE_DEBUG === "true",

  
  web: {
    baseUrl: process.env.PIXIE_WEB_BASE_URL || `http://localhost:${process.env.PIXIE_WEB_PORT || 4100}`,
  },

  
  
  
  escalateReaction: (process.env.PIXIE_ESCALATE_REACTION || "").replace(/:/g, "").trim() || null,

  
  
  
  
  
  
  feedbackReactions: (process.env.PIXIE_FEEDBACK_REACTIONS ?? "")
    .split(",")
    .map((r) => r.replace(/:/g, "").trim())
    .filter(Boolean),
};

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

async function resolveBotUserId(client) {
  const auth = await client.auth.test();
  config.slack.botUserId = auth.user_id;
  return auth.user_id;
}

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
