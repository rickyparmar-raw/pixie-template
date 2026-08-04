// The answer cache — both the policy and its storage.
//
// The same handful of questions get asked constantly in a help channel ("whats
// the deadline", "where do i play"), and each one was a full corpus round-trip.
// Keyed on a normalised question so wording noise doesn't split the key.
//
// The SQL lives here rather than in lib/db.js because the retention rules and
// the queries that implement them are one idea: what counts as a hit, what
// counts as stale, and what is safe to forget. Splitting them meant reading two
// files to answer any of those. lib/db.js still owns the connection and the
// sweep.
const crypto = require("crypto");
const db = require("./db");
const retrieve = require("./retrieve");

// Only cache context-free lookups — once thread history or user history is in
// the prompt, the answer is specific to that conversation.
//
// The key is a SORTED SET of meaningful words, not the sentence. Keeping word
// order and filler meant "whats the deadline", "when is the deadline" and
// "deadline?" were three separate keys for one answer, which is most of why the
// measured hit rate was 2.6%. retrieve.tokenize already lowercases, strips
// punctuation and drops the stopwords that carry no meaning; what survives is
// the words that decide which question this is, so "how do i submit" and "can i
// submit late" still hash apart.
function normalize(question) {
  const terms = retrieve.tokenize((question || "").replace(/<@[^>]+>/g, " "));
  return [...new Set(terms)].sort().join(" ");
}

// Null when nothing meaningful survives normalisation. "hi pixie" and "thanks!"
// both reduce to the empty string, and sharing one key would serve one of them
// the other's reply.
function keyFor(question, programId = null) {
  const normalized = normalize(question);
  if (!normalized) return null;
  const input = programId ? `${programId}:${normalized}` : normalized;
  return crypto.createHash("sha1").update(input).digest("hex");
}

// The one source whose answers cannot be served stale. A timeline answer embeds
// a live countdown — "august 18, in 21 days" — so yesterday's copy is not merely
// old, it is wrong, and wrong about the single most-asked category. Everything
// else describes rules and processes that don't change between refreshes.
const VOLATILE_SOURCE = "Program timeline";

function isVolatile(source) {
  return (source || "").trim().toLowerCase() === VOLATILE_SOURCE.toLowerCase();
}

// A hit still counts as a hit past CACHE_FRESH_MS: lib/warm.js regenerates the
// popular ones in the background, so serving the known-good previous answer
// costs one Slack round trip instead of making someone wait on the model for an
// answer that is almost certainly identical. Volatile sources are the exception
// and fall through to a real lookup once they age out.
function get(question, programId = null) {
  const key = keyFor(question, programId);
  if (!key) return null;

  let hit = getCachedAnswer(key);
  if (!hit) {
    const candidates = [
      programId !== "ysws-global" ? keyFor(question, "ysws-global") : null,
      programId !== "pixl" ? keyFor(question, "pixl") : null,
      programId !== null ? keyFor(question, null) : null,
    ].filter(Boolean);

    for (const altKey of candidates) {
      if (altKey && altKey !== key) {
        hit = getCachedAnswer(altKey);
        if (hit) break;
      }
    }
  }
  if (!hit) return null;
  if (isVolatile(hit.source) && hit.ageMs > db.CACHE_FRESH_MS) return null;

  return { source: hit.source, answer: hit.answer };
}

function put(question, result, options = {}, programId = null) {
  if (typeof options === "string") {
    programId = options;
    options = {};
  }
  const key = keyFor(question, programId);
  if (key) putCachedAnswer(key, question, result, options || {});
}

/* --------------------------------------------------------------- storage -- */

// Returns the row plus how long ago its answer was written, and records the
// ask. Deliberately does NOT apply a freshness cutoff itself: an old entry for
// a question people keep asking is worth serving while a refresh runs behind it
// (lib/warm.js), and only the caller knows whether this particular answer is
// safe to serve slightly stale. See lib/cache.js.
//
// The bump is what makes pixie faster over time — it is the only record of
// which questions are worth remembering.
function cacheRow(hash) {
  return db.handle()
    .query("SELECT source, answer, ask_count, COALESCE(refreshed_at, created_at) AS written_at FROM answer_cache WHERE question_hash = ?")
    .get(hash) || null;
}

// Read-only cache inspection for the web probe. It must not increment ask_count
// or update last_asked_at: opening the console must not influence cache stats.
function peekCachedAnswer(hash) {
  const row = cacheRow(hash);
  if (!row) return null;
  return { source: row.source, answer: row.answer, askCount: row.ask_count, ageMs: db.now() - row.written_at };
}

function getCachedAnswer(hash) {
  const hit = peekCachedAnswer(hash);
  if (!hit) return null;

  db.handle()
    .query("UPDATE answer_cache SET ask_count = ask_count + 1, last_asked_at = ? WHERE question_hash = ?")
    .run(db.now(), hash);

  return hit;
}

// `refreshed` marks a background rewrite (lib/warm.js) rather than a first
// answer: it keeps ask_count and last_asked_at intact, because nobody asked —
// pixie just brought the answer up to date on its own.
function putCachedAnswer(hash, question, result, { refreshed = false } = {}) {
  const t = db.now();
  db.handle()
    .query(
      `INSERT INTO answer_cache (question_hash, question, source, answer, created_at, last_asked_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(question_hash) DO UPDATE SET
         source = excluded.source, answer = excluded.answer, refreshed_at = excluded.refreshed_at`,
    )
    .run(hash, question, result.source || null, result.answer, t, refreshed ? null : t, t);
}

// The entries worth spending a background model call on: stale, and ordered by
// how often people ask them.
function staleCacheEntries(staleAfterMs, limit) {
  return db.handle()
    .query(
      `SELECT question_hash, question, ask_count FROM answer_cache
       WHERE COALESCE(refreshed_at, created_at) < ?
       ORDER BY ask_count DESC, COALESCE(refreshed_at, created_at) ASC
       LIMIT ?`,
    )
    .all(db.now() - staleAfterMs, limit);
}

function cachedCount() {
  return db.handle().query("SELECT COUNT(*) AS n FROM answer_cache").get()?.n || 0;
}

function topCached(limit = 5) {
  return db.handle()
    .query("SELECT question_hash, question, ask_count, source, COALESCE(refreshed_at, created_at) AS written_at FROM answer_cache ORDER BY ask_count DESC, question LIMIT ?")
    .all(limit);
}

function clearCache() {
  db.handle().query("DELETE FROM answer_cache").run();
}

function forget(hash) {
  db.handle().query("DELETE FROM answer_cache WHERE question_hash = ?").run(hash);
}

module.exports = {
  get,
  put,
  keyFor,
  normalize,
  isVolatile,
  VOLATILE_SOURCE,
  getCachedAnswer,
  peekCachedAnswer,
  putCachedAnswer,
  staleCacheEntries,
  cachedCount,
  topCached,
  clearCache,
  forget,
};
