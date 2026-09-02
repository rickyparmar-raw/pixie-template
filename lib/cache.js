

const crypto = require("crypto");
const db = require("./db");
const retrieve = require("./retrieve");

function normalize(question) {
  const terms = retrieve.tokenize((question || "").replace(/<@[^>]+>/g, " "));
  return [...new Set(terms)].sort().join(" ");
}

function keyFor(question, programId = null) {
  const normalized = normalize(question);
  if (!normalized) return null;
  const input = programId ? `${programId}:${normalized}` : normalized;
  return crypto.createHash("sha1").update(input).digest("hex");
}

const VOLATILE_SOURCE = "Program timeline";

function isVolatile(source) {
  return (source || "").trim().toLowerCase() === VOLATILE_SOURCE.toLowerCase();
}

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

function cacheRow(hash) {
  return db.handle()
    .query("SELECT source, answer, ask_count, COALESCE(refreshed_at, created_at) AS written_at FROM answer_cache WHERE question_hash = ?")
    .get(hash) || null;
}

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
