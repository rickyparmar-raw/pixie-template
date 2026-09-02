

const knowledge = require("./knowledge");
const cache = require("./cache");
const db = require("./db");
const log = require("./log");

const lookup = require("./lookup");

const CYCLE_MS = 5 * 60 * 1000;

const PER_CYCLE = 4;
const SPACING_MS = 8000;

let timer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warmOne(question, { refreshed = false } = {}) {
  const result = await lookup.answerOrChat(question, "");
  
  
  
  if (!result?.source) return false;

  
  
  if (refreshed) cache.put(question, result, { refreshed: true });
  return true;
}

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

function start({ cycleMs = CYCLE_MS } = {}) {
  if (timer) return timer;

  warmFaq().catch((e) => log.error("warm", "faq pre-warm failed:", e.message));

  timer = setInterval(() => {
    refreshStale().catch((e) => log.error("warm", "refresh pass failed:", e.message));
  }, cycleMs);
  
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, warmFaq, refreshStale, warmOne, faqQuestions, CYCLE_MS, PER_CYCLE, SPACING_MS };
