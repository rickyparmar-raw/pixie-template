// Keeps the answers people actually ask for warm, so pixie gets faster the more
// it is used instead of resetting every six hours.
//
// Two jobs, both strictly background — nothing here is ever between a person and
// a reply:
//
//   1. On boot, answer the FAQ questions that aren't cached yet, so a fresh
//      deployment already knows the canonical asks instead of learning each one
//      through a slow first ask.
//   2. On a timer, regenerate the stalest entries most-asked-first, so a popular
//      answer stays current without anyone waiting for it.
//
// Pacing is the whole safety story. The model is a free tier with a finite
// budget and a per-minute ceiling; a warmer that fires a burst would push real
// questions into a queue behind housekeeping, which is the exact opposite of
// the point. One call at a time, spaced, and a hard cap per cycle.
const knowledge = require("./knowledge");
const cache = require("./cache");
const db = require("./db");
const log = require("./log");
// Module object rather than destructured, so tests can stub the model call —
// see the note in lib/respond.js.
const lookup = require("./lookup");

const CYCLE_MS = 5 * 60 * 1000;
// Small enough that a cycle can never look like a burst: 4 calls spread over
// ~30s, once every 5 minutes.
const PER_CYCLE = 4;
const SPACING_MS = 8000;

let timer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Answers a question exactly the way a person asking it would, and lets
// lookup.answerOrChat write the cache — the warmer must never become a second
// answering path that can drift from the real one. Empty context prompt is what
// makes it cacheable at all.
async function warmOne(question, { refreshed = false } = {}) {
  const result = await lookup.answerOrChat(question, "");
  // No source means the docs don't cover it. Nothing to cache, and a chat reply
  // is specific to whoever asked — writing it would hand the next person an
  // answer addressed to someone else.
  if (!result?.source) return false;

  // answerOrChat already cached it as a fresh entry. A background refresh has to
  // say so, so it doesn't look like somebody asked.
  if (refreshed) cache.put(question, result, { refreshed: true });
  return true;
}

// The FAQ sources are Q/A pairs, so their questions are the canonical asks —
// literally the list someone wrote down as "what people ask". 16 of them at time
// of writing, which is one gentle pass.
function faqQuestions() {
  return knowledge
    .faqQuestions()
    .map((q) => (q || "").trim())
    .filter(Boolean);
}

async function warmFaq({ limit = 2, spacingMs = 15000 } = {}) {
  const questions = faqQuestions().filter((q) => !cache.get(q)).slice(0, limit);
  if (questions.length === 0) {
    log.debug("warm", "faq already warm");
    return 0;
  }

  log.info("warm", `pre-warming ${questions.length} FAQ question(s)`);
  let warmed = 0;
  for (const question of questions) {
    try {
      if (await warmOne(question)) warmed += 1;
    } catch (e) {
      log.debug("warm", `could not pre-warm "${question.slice(0, 40)}": ${e.message}`);
    }
    await sleep(spacingMs);
  }

  log.info("warm", `pre-warmed ${warmed}/${questions.length} FAQ answers`);
  return warmed;
}

// One refresh pass. Most-asked first, so the limited budget goes to the answers
// the most people are waiting on.
async function refreshStale({ limit = PER_CYCLE, spacingMs = SPACING_MS } = {}) {
  const stale = cache.staleCacheEntries(db.CACHE_FRESH_MS, limit);
  if (stale.length === 0) return 0;

  let refreshed = 0;
  for (const entry of stale) {
    try {
      if (await warmOne(entry.question, { refreshed: true })) {
        refreshed += 1;
        log.debug("warm", `refreshed "${entry.question.slice(0, 40)}" (asked ${entry.ask_count}x)`);
      }
    } catch (e) {
      log.debug("warm", `could not refresh "${entry.question.slice(0, 40)}": ${e.message}`);
    }
    await sleep(spacingMs);
  }

  if (refreshed > 0) log.info("warm", `refreshed ${refreshed} cached answer(s)`);
  return refreshed;
}

// Boot pre-warm runs once, then the refresh loop takes over. Both are fire-and-
// forget: a warmer that throws must not take the bot down with it.
function start({ cycleMs = CYCLE_MS } = {}) {
  if (timer) return timer;

  warmFaq().catch((e) => log.error("warm", "faq pre-warm failed:", e.message));

  timer = setInterval(() => {
    refreshStale().catch((e) => log.error("warm", "refresh pass failed:", e.message));
  }, cycleMs);
  // Housekeeping should never be the reason the process stays alive.
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, warmFaq, refreshStale, warmOne, faqQuestions, CYCLE_MS, PER_CYCLE, SPACING_MS };
