// Counts and timestamps, rendered. Both surfaces that report on pixie — the
// /pixie-stats command and the App Home tab — read from here, so they can't
// drift apart and quote different numbers for the same week.
const db = require("./db");
const cache = require("./cache");
const { config } = require("./config");

function relativeTime(ms) {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// `rate` is the number the docs live or die by: the share of questions pixie
// answered from the corpus rather than from the model's general knowledge.
function coverageStats() {
  const counts = Object.fromEntries(db.metricCounts().map((r) => [r.kind, r.count]));
  const docs = counts.answer_docs || 0;
  const chat = counts.answer_chat || 0;
  const link = counts.answer_link || 0;
  const fallback = counts.fallback || 0;
  const silent = counts.silent || 0;

  const asked = docs + chat + link + fallback + silent;
  // What pixie has learned to answer without thinking about it. `known` is how
  // many questions it now recognises; `instant` is the share of answers that
  // cost no model call at all — the number that should climb on its own as the
  // channel keeps asking things.
  const cacheHits = counts.cache_hit || 0;
  const answered = docs + chat + link;

  return {
    counts,
    docs,
    chat,
    link,
    fallback,
    silent,
    asked,
    rate: asked > 0 ? Math.round((docs / asked) * 100) : 0,
    cacheHits,
    known: cache.cachedCount(),
    instant: answered > 0 ? Math.round((cacheHits / answered) * 100) : 0,
  };
}

function statsText() {
  const { counts, docs, chat, link, fallback, silent, rate, cacheHits, known, instant } = coverageStats();
  const vision = counts.answer_vision || 0;
  const errors = counts.error || 0;

  const votes = db.feedbackTotals();
  const p50 = db.medianLatency("answer_docs");
  const firstToken = db.medianLatency("first_token");
  const top = cache.topCached(3).filter((row) => row.ask_count > 1);

  return [
    "*pixie stats* (last 7d)",
    `• answered from docs: *${docs}* (${rate}% of questions)`,
    `• answered conversationally: *${chat}*`,
    `• answered with link context: *${link}*`,
    `• image analyses: *${vision}*`,
    `• fell back / stayed silent: *${fallback + silent}*`,
    `• errors: *${errors}*`,
    `• answers known cold: *${known}* — ${cacheHits} served instantly (${instant}%)`,
    `• feedback: :${config.feedbackReactions[0] || "thumbs-up"}: ${votes.up || 0} / :nono: ${votes.down || 0}`,
    p50 ? `• median answer latency: *${(p50 / 1000).toFixed(1)}s*` : "• median answer latency: _no data_",
    firstToken ? `• median time to first word: *${(firstToken / 1000).toFixed(1)}s*` : null,
    top.length > 0 ? `• asked most: ${top.map((r) => `_${r.question}_ (${r.ask_count}x)`).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  relativeTime,
  coverageStats,
  statsText,
};
