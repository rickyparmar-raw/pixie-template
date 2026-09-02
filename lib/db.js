

const path = require("path");
const { Database } = require("bun:sqlite");
const { SCHEMA, MIGRATIONS, POST_MIGRATION_SCHEMA } = require("./schema");
const log = require("./log");

const DEFAULT_PATH = path.join(__dirname, "..", "pixie.db");

const ANSWERED_TTL_MS = 24 * 60 * 60 * 1000;
const THREAD_TTL_MS = 60 * 60 * 1000;
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GUIDE_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const CACHE_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_THREAD_MESSAGES = 20;
const MAX_USER_TOPICS = 10;

const MAX_USER_MESSAGES = 12;
const USER_MESSAGE_WINDOW_MS = 2 * 60 * 60 * 1000;
const USER_MESSAGE_TTL_MS = 6 * 60 * 60 * 1000;

let db = null;
let sweepTimer = null;

function migrate(database) {
  for (const [table, column, sql] of MIGRATIONS) {
    if (sql.startsWith("CREATE TABLE")) {
      const exists = database
        .query("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
        .get("table", table);
      if (exists) continue;
    } else {
      const columns = database.query(`PRAGMA table_info(${table})`).all();
      if (columns.some((c) => c.name === column)) continue;
    }
    database.exec(sql);
    log.info("db", `migrated: ${table}.${column}`);
  }
}

function open(filename = process.env.PIXIE_DB_PATH || DEFAULT_PATH) {
  if (db) return db;
  db = new Database(filename, { create: true });
  
  
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  migrate(db);
  db.exec(POST_MIGRATION_SCHEMA);
  db.exec("DELETE FROM answer_cache");
  log.info("db", `opened ${filename}`);
  return db;
}

function handle() {
  if (!db) open();
  return db;
}

function now() {
  return Date.now();
}

function claimMessage(ts, channel = null) {
  const changes = handle()
    .query("INSERT OR IGNORE INTO answered_messages (ts, channel, answered_at) VALUES (?, ?, ?)")
    .run(ts, channel, now());
  return changes.changes > 0;
}

function wasAnswered(ts) {
  return !!handle().query("SELECT 1 FROM answered_messages WHERE ts = ?").get(ts);
}

function touchThread(threadTs, channel = null, fields = {}) {
  handle()
    .query(
      `INSERT INTO threads (thread_ts, channel, seeded, pixie_spoke, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_ts) DO UPDATE SET
         channel     = COALESCE(excluded.channel, threads.channel),
         seeded      = MAX(threads.seeded, excluded.seeded),
         pixie_spoke = MAX(threads.pixie_spoke, excluded.pixie_spoke),
         updated_at  = excluded.updated_at`,
    )
    .run(threadTs, channel, fields.seeded ? 1 : 0, fields.pixieSpoke ? 1 : 0, now());
}

function getThread(threadTs) {
  return handle().query("SELECT * FROM threads WHERE thread_ts = ?").get(threadTs) || null;
}

function addThreadMessage(threadTs, role, content, userId = null) {
  handle()
    .query("INSERT INTO thread_messages (thread_ts, role, content, user_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(threadTs, role, content, userId, now());

  
  handle()
    .query(
      `DELETE FROM thread_messages
       WHERE thread_ts = ? AND id NOT IN (
         SELECT id FROM thread_messages WHERE thread_ts = ? ORDER BY id DESC LIMIT ?
       )`,
    )
    .run(threadTs, threadTs, MAX_THREAD_MESSAGES);
}

function getThreadMessages(threadTs) {
  const cutoff = now() - THREAD_TTL_MS;
  return handle()
    .query("SELECT role, content, user_id FROM thread_messages WHERE thread_ts = ? AND created_at > ? ORDER BY id ASC")
    .all(threadTs, cutoff);
}

const ephemeralUserMessages = new Map();

function recordUserMessage({ userId, channel = null, threadTs = null, text }) {
  const body = (text || "").trim();
  if (!userId || !body) return;

  const list = ephemeralUserMessages.get(userId) || [];
  list.push({ text: body, channel, threadTs, created_at: now() });
  if (list.length > MAX_USER_MESSAGES) {
    list.splice(0, list.length - MAX_USER_MESSAGES);
  }
  ephemeralUserMessages.set(userId, list);
}

function recentUserMessages(userId, { channel = null, limit = 3 } = {}) {
  if (!userId) return [];
  const cutoff = now() - USER_MESSAGE_WINDOW_MS;
  const list = (ephemeralUserMessages.get(userId) || [])
    .filter((m) => m.created_at > cutoff && (!channel || m.channel === channel));
  return list.slice(-limit);
}

function recordTopic(userId, topic, wasHelpful = true) {
  if (!userId || !topic) return;
  handle()
    .query(
      `INSERT INTO user_topics (user_id, topic, was_helpful, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, topic) DO UPDATE SET created_at = excluded.created_at, was_helpful = excluded.was_helpful`,
    )
    .run(userId, topic, wasHelpful ? 1 : 0, now());

  handle()
    .query(
      `DELETE FROM user_topics
       WHERE user_id = ? AND topic NOT IN (
         SELECT topic FROM user_topics WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    )
    .run(userId, userId, MAX_USER_TOPICS);
}

function getTopics(userId) {
  if (!userId) return [];
  const cutoff = now() - HISTORY_TTL_MS;
  return handle()
    .query("SELECT topic, was_helpful FROM user_topics WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC")
    .all(userId, cutoff);
}

function recordGap(question, userId = null, channel = null, messageTs = null) {
  
  
  
  handle()
    .query("INSERT INTO doc_gaps (question, user_id, channel, message_ts, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(normalizeQuestion(question), userId, channel, messageTs, now());
}

function normalizeQuestion(question) {
  return String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function recordGapRejection(question) {
  const normalized = normalizeQuestion(question);
  if (!normalized) return;
  handle()
    .query("INSERT OR REPLACE INTO gap_rejections (question, created_at) VALUES (?, ?)")
    .run(normalized, now());
}

function clearGapRejection(question) {
  const normalized = normalizeQuestion(question);
  if (!normalized) return;
  handle().query("DELETE FROM gap_rejections WHERE question = ?").run(normalized);
}

function gapForThread(messageTs, sinceMs = 7 * 24 * 60 * 60 * 1000) {
  if (!messageTs) return null;
  return (
    handle()
      .query("SELECT question, user_id FROM doc_gaps WHERE message_ts = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1")
      .get(messageTs, now() - sinceMs) || null
  );
}

function topGaps(limit = 20, sinceMs = 30 * 24 * 60 * 60 * 1000, {
  kind = null,
  untilMs = null,
  programId = null,
  minAskers = 2,
  excludeRejected = true,
} = {}) {
  const clauses = ["created_at > ?"];
  const params = [now() - sinceMs];

  if (untilMs !== null) {
    clauses.push("created_at <= ?");
    params.push(untilMs);
  }
  if (kind !== null) {
    clauses.push("kind = ?");
    params.push(kind);
  }
  if (programId !== null) {
    clauses.push("(program_id = ? OR program_id IS NULL)");
    params.push(programId);
  }
  
  
  
  
  
  const normalizedQuestion = "LOWER(TRIM(question))";

  if (excludeRejected) {
    clauses.push(`${normalizedQuestion} NOT IN (SELECT question FROM gap_rejections WHERE created_at > ?)`);
    params.push(now() - sinceMs);
  }
  const sql = `SELECT MIN(id) AS id,
                      ${normalizedQuestion} AS question,
                      COUNT(*) AS ask_count,
                      COUNT(DISTINCT user_id) AS askers,
                      MAX(created_at) AS last_asked
               FROM doc_gaps WHERE ${clauses.join(" AND ")}
               GROUP BY ${normalizedQuestion}
               HAVING COUNT(DISTINCT user_id) >= ?
               ORDER BY askers DESC, ask_count DESC, last_asked DESC
               LIMIT ?`;
  params.push(minAskers, limit);

  return handle().query(sql).all(...params);
}

function unclassifiedGaps(limit = 5) {
  return handle()
    .query("SELECT id, question FROM doc_gaps WHERE kind IS NULL ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

function setGapKind(id, kind) {
  handle().query("UPDATE doc_gaps SET kind = ? WHERE id = ?").run(kind, id);
}

function gapThreads(question, limit = 2, sinceMs = 30 * 24 * 60 * 60 * 1000) {
  return handle()
    .query(
      `SELECT DISTINCT channel, message_ts FROM doc_gaps
       WHERE LOWER(TRIM(question)) = LOWER(TRIM(?)) AND created_at > ? AND channel IS NOT NULL AND message_ts IS NOT NULL
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(question, now() - sinceMs, limit);
}

function gapCountsByKind(sinceMs = 7 * 24 * 60 * 60 * 1000, untilMs = null, programId = null) {
  const upper = untilMs === null ? now() : untilMs;
  const clauses = ["created_at > ?", "created_at <= ?"];
  const params = [now() - sinceMs, upper];
  if (programId) {
    clauses.push("(program_id = ? OR program_id IS NULL)");
    params.push(programId);
  }

  return Object.fromEntries(
    handle()
      .query(
        `SELECT COALESCE(kind, 'unjudged') AS kind, COUNT(DISTINCT LOWER(TRIM(question))) AS count
         FROM doc_gaps WHERE ${clauses.join(" AND ")}
         GROUP BY COALESCE(kind, 'unjudged')`,
      )
      .all(...params)
      .map((r) => [r.kind, r.count]),
  );
}

function recordFeedback(messageTs, userId, vote) {
  handle()
    .query(
      `INSERT INTO feedback (message_ts, user_id, vote, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_ts, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`,
    )
    .run(messageTs, userId, vote, now());
}

function removeFeedback(messageTs, userId) {
  handle().query("DELETE FROM feedback WHERE message_ts = ? AND user_id = ?").run(messageTs, userId);
}

function feedbackTotals() {
  return (
    handle()
      .query("SELECT SUM(vote > 0) AS up, SUM(vote < 0) AS down FROM feedback")
      .get() || { up: 0, down: 0 }
  );
}

function addLearnedFact({ question, answer, authorId = null, status = "pending", sourceTs = null, channel = null, programId = null }) {
  const result = handle()
    .query(
      `INSERT OR IGNORE INTO learned_facts (question, answer, author_id, status, source_ts, channel, program_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(question, answer, authorId, status, sourceTs, channel, programId, now());
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

function listLearnedFacts(status, limit = 25, programId = null) {
  if (programId) {
    return handle()
      .query("SELECT * FROM learned_facts WHERE status = ? AND (program_id = ? OR program_id IS NULL) ORDER BY created_at ASC LIMIT ?")
      .all(status, programId, limit);
  }
  return handle()
    .query("SELECT * FROM learned_facts WHERE status = ? ORDER BY created_at ASC LIMIT ?")
    .all(status, limit);
}

function getLearnedFactById(id) {
  return (
    handle()
      .query("SELECT * FROM learned_facts WHERE id = ?")
      .get(id) || null
  );
}

function approvedFacts(limit = 50, programId = null) {
  if (programId) {
    return handle()
      .query("SELECT question, answer FROM learned_facts WHERE status = 'approved' AND (program_id = ? OR program_id IS NULL) ORDER BY created_at DESC LIMIT ?")
      .all(programId, limit)
      .reverse();
  }
  return handle()
    .query("SELECT question, answer FROM learned_facts WHERE status = 'approved' ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .reverse();
}

function setLearnedStatus(id, status) {
  const result = handle().query("UPDATE learned_facts SET status = ? WHERE id = ?").run(status, id);
  return result.changes > 0;
}

function deleteLearnedFact(id) {
  return handle().query("DELETE FROM learned_facts WHERE id = ?").run(id).changes > 0;
}

function deleteLearnedByStatus(status) {
  if (status === "all") {
    return handle().query("DELETE FROM learned_facts").run().changes;
  }
  return handle().query("DELETE FROM learned_facts WHERE status = ?").run(status).changes;
}

function deleteLearnedRange(fromId, toId) {
  return handle().query("DELETE FROM learned_facts WHERE id >= ? AND id <= ?").run(fromId, toId).changes;
}

function pendingCountForQuestion(question) {
  return (
    handle()
      .query("SELECT COUNT(*) AS count FROM learned_facts WHERE status = 'pending' AND LOWER(TRIM(question)) = LOWER(TRIM(?))")
      .get(question)?.count || 0
  );
}

function hasCapturedSource(sourceTs) {
  if (!sourceTs) return false;
  return Boolean(
    handle().query("SELECT 1 FROM learned_facts WHERE source_ts = ? LIMIT 1").get(sourceTs),
  );
}

function saveGuide(threadTs, guideId, currentStep, userId) {
  handle()
    .query(
      `INSERT INTO active_guides (thread_ts, guide_id, current_step, user_id, started_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_ts) DO UPDATE SET guide_id = excluded.guide_id, current_step = excluded.current_step`,
    )
    .run(threadTs, guideId, currentStep, userId, now());
}

function getGuide(threadTs) {
  const cutoff = now() - GUIDE_TTL_MS;
  return handle().query("SELECT * FROM active_guides WHERE thread_ts = ? AND started_at > ?").get(threadTs, cutoff) || null;
}

function setGuideMessageTs(threadTs, messageTs) {
  handle().query("UPDATE active_guides SET message_ts = ? WHERE thread_ts = ?").run(messageTs, threadTs);
}

function getGuideByMessageTs(messageTs) {
  const cutoff = now() - GUIDE_TTL_MS;
  return (
    handle().query("SELECT * FROM active_guides WHERE message_ts = ? AND started_at > ?").get(messageTs, cutoff) ||
    null
  );
}

function deleteGuide(threadTs) {
  handle().query("DELETE FROM active_guides WHERE thread_ts = ?").run(threadTs);
}

function muteThread(threadTs, channel = null) {
  handle()
    .query("INSERT OR REPLACE INTO muted_threads (thread_ts, channel, muted_at) VALUES (?, ?, ?)")
    .run(threadTs, channel, now());
}

function isThreadMuted(threadTs) {
  if (!threadTs) return false;
  const row = handle().query("SELECT 1 FROM muted_threads WHERE thread_ts = ? LIMIT 1").get(threadTs);
  return !!row;
}

function unmuteThread(threadTs) {
  if (!threadTs) return;
  handle().query("DELETE FROM muted_threads WHERE thread_ts = ?").run(threadTs);
}

function recordMetric(kind, latencyMs = null, detail = null) {
  handle().query("INSERT INTO metrics (kind, latency_ms, detail, created_at) VALUES (?, ?, ?, ?)").run(kind, latencyMs, detail, now());
}

function metricCounts(sinceMs = 7 * 24 * 60 * 60 * 1000, untilMs = null) {
  return handle()
    .query("SELECT kind, COUNT(*) AS count FROM metrics WHERE created_at > ? AND created_at <= ? GROUP BY kind")
    .all(now() - sinceMs, untilMs === null ? now() : untilMs);
}

function lastMetricAt(kind) {
  return handle().query("SELECT MAX(created_at) AS at FROM metrics WHERE kind = ?").get(kind)?.at || null;
}

function metricDetails(kind, sinceMs = 7 * 24 * 60 * 60 * 1000) {
  return handle()
    .query("SELECT detail, COUNT(*) AS count FROM metrics WHERE kind = ? AND detail IS NOT NULL AND created_at > ? GROUP BY detail ORDER BY count DESC")
    .all(kind, now() - sinceMs);
}

function medianLatency(kind, sinceMs = 7 * 24 * 60 * 60 * 1000) {
  const rows = handle()
    .query("SELECT latency_ms FROM metrics WHERE kind = ? AND latency_ms IS NOT NULL AND created_at > ? ORDER BY latency_ms")
    .all(kind, now() - sinceMs);
  if (rows.length === 0) return null;
  return rows[Math.floor(rows.length / 2)].latency_ms;
}

function countRecentRequests(userId, windowMs) {
  const row = handle()
    .query("SELECT COUNT(*) AS count FROM rate_limits WHERE user_id = ? AND created_at > ?")
    .get(userId, now() - windowMs);
  return row?.count || 0;
}

function recordRequest(userId) {
  handle().query("INSERT INTO rate_limits (user_id, created_at) VALUES (?, ?)").run(userId, now());
}

function sweep() {
  const t = now();
  const d = handle();
  d.query("DELETE FROM answered_messages WHERE answered_at < ?").run(t - ANSWERED_TTL_MS);
  d.query("DELETE FROM thread_messages WHERE created_at < ?").run(t - THREAD_TTL_MS);
  d.query("DELETE FROM threads WHERE updated_at < ?").run(t - THREAD_TTL_MS);
  d.query("DELETE FROM user_topics WHERE created_at < ?").run(t - HISTORY_TTL_MS);
  d.query("DELETE FROM user_messages WHERE created_at < ?").run(t - USER_MESSAGE_TTL_MS);
  
  
  
  d.query("DELETE FROM answer_cache WHERE COALESCE(last_asked_at, created_at) < ?").run(t - CACHE_IDLE_MS);
  d.query("DELETE FROM active_guides WHERE started_at < ?").run(t - GUIDE_TTL_MS);
  d.query("DELETE FROM rate_limits WHERE created_at < ?").run(t - 60 * 60 * 1000);

  
  
  
  
  try {
    d.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (e) {
    log.debug("db", `wal checkpoint skipped: ${e.message}`);
  }
}

function startSweeper() {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(() => {
    try {
      sweep();
    } catch (e) {
      log.error("db", "sweep failed:", e.message);
    }
  }, SWEEP_INTERVAL_MS);
  
  if (sweepTimer.unref) sweepTimer.unref();
  return sweepTimer;
}

function close() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  if (db) db.close();
  db = null;
}

function saveSourceText(name, text) {
  handle()
    .query(
      "INSERT INTO source_cache (name, text, fetched_at) VALUES (?, ?, ?)" +
        " ON CONFLICT(name) DO UPDATE SET text = excluded.text, fetched_at = excluded.fetched_at",
    )
    .run(name, text, now());
}

function loadSourceText(name) {
  const row = handle().query("SELECT text, fetched_at FROM source_cache WHERE name = ?").get(name);
  if (!row) return null;
  return { text: row.text, fetchedAt: row.fetched_at };
}

function getDbPrograms() {
  const rows = handle().query("SELECT * FROM programs ORDER BY id ASC").all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    posture: r.posture,
    scope: r.scope || "any",
    helpChannel: r.help_channel,
    channels: r.channels ? JSON.parse(r.channels) : [],
    helperGroup: r.helper_group,
    sources: r.sources ? JSON.parse(r.sources) : null,
    milestones: r.milestones ? JSON.parse(r.milestones) : null,
    guides: r.guides ? JSON.parse(r.guides) : null,
    links: r.links ? JSON.parse(r.links) : null,
    updatedAt: r.updated_at,
  }));
}

function saveProgram(p) {
  const existing = handle().query("SELECT 1 FROM programs WHERE id = ?").get(p.id);
  const nowTs = now();
  const channels = p.channels ? JSON.stringify(p.channels) : null;
  const sources = p.sources ? JSON.stringify(p.sources) : null;
  const milestones = p.milestones ? JSON.stringify(p.milestones) : null;
  const guides = p.guides ? JSON.stringify(p.guides) : null;
  const links = p.links ? JSON.stringify(p.links) : null;

  if (existing) {
    handle()
      .query(
        `UPDATE programs SET name = ?, posture = ?, scope = ?, help_channel = ?, channels = ?, helper_group = ?, sources = ?, milestones = ?, guides = ?, links = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        p.name,
        p.posture || "active",
        p.scope || "any",
        p.helpChannel || null,
        channels,
        p.helperGroup || null,
        sources,
        milestones,
        guides,
        links,
        nowTs,
        p.id,
      );
  } else {
    handle()
      .query(
        `INSERT INTO programs (id, name, posture, scope, help_channel, channels, helper_group, sources, milestones, guides, links, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.name,
        p.posture || "active",
        p.scope || "any",
        p.helpChannel || null,
        channels,
        p.helperGroup || null,
        sources,
        milestones,
        guides,
        links,
        nowTs,
      );
  }
}

function deleteProgram(id) {
  return handle().query("DELETE FROM programs WHERE id = ?").run(id).changes > 0;
}

function createTicket({ programId, channel, threadTs, requesterId, question }) {
  const result = handle()
    .query(
      `INSERT INTO tickets (program_id, channel, thread_ts, requester_id, question, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(programId, channel, threadTs, requesterId, question, now());
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

function getTicket(id) {
  return handle().query("SELECT * FROM tickets WHERE id = ?").get(id) || null;
}

function getTicketByThreadTs(threadTs) {
  return handle().query("SELECT * FROM tickets WHERE thread_ts = ? LIMIT 1").get(threadTs) || null;
}

function updateTicketCardTs(id, cardTs) {
  return handle().query("UPDATE tickets SET card_ts = ? WHERE id = ?").run(cardTs, id).changes > 0;
}

function claimTicket(id, assigneeId) {
  return (
    handle()
      .query("UPDATE tickets SET status = 'claimed', assignee_id = ?, claimed_at = ? WHERE id = ? AND status = 'open'")
      .run(assigneeId, now(), id).changes > 0
  );
}

function unclaimTicket(id) {
  return (
    handle()
      .query("UPDATE tickets SET status = 'open', assignee_id = NULL, claimed_at = NULL WHERE id = ?")
      .run(id).changes > 0
  );
}

function resolveTicket(id, resolution = "resolved") {
  return (
    handle()
      .query("UPDATE tickets SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?")
      .run(resolution, now(), id).changes > 0
  );
}

function reopenTicket(id) {
  return (
    handle()
      .query("UPDATE tickets SET status = 'open', resolution = NULL, resolved_at = NULL WHERE id = ?")
      .run(id).changes > 0
  );
}

function closeTicket(id) {
  return handle().query("UPDATE tickets SET status = 'closed', resolved_at = ? WHERE id = ?").run(now(), id).changes > 0;
}

function getTicketsForProgram(programId, status = null) {
  if (status) {
    return handle()
      .query("SELECT * FROM tickets WHERE program_id = ? AND status = ? ORDER BY created_at DESC")
      .all(programId, status);
  }
  return handle()
    .query("SELECT * FROM tickets WHERE program_id = ? ORDER BY created_at DESC")
    .all(programId);
}

function recordAnsweredThread({ question, channel, threadTs }) {
  if (!question || !channel || !threadTs) return;
  const cleanQ = String(question).trim();
  if (!cleanQ) return;
  try {
    handle()
      .query(
        "INSERT INTO answered_threads (question, channel, thread_ts, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(cleanQ, channel, threadTs, now());
  } catch (err) {
    log.debug("db", `recordAnsweredThread failed: ${err.message}`);
  }
}

function getRecentAnsweredThreads(limit = 100) {
  try {
    return handle()
      .query(
        "SELECT id, question, channel, thread_ts, created_at FROM answered_threads ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit);
  } catch (err) {
    log.debug("db", `getRecentAnsweredThreads failed: ${err.message}`);
    return [];
  }
}

function getLearnedFactsWithThreads(limit = 100) {
  try {
    return handle()
      .query(
        "SELECT id, question, channel, source_ts FROM learned_facts WHERE source_ts IS NOT NULL AND channel IS NOT NULL ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit);
  } catch (err) {
    log.debug("db", `getLearnedFactsWithThreads failed: ${err.message}`);
    return [];
  }
}

module.exports = {
  open,
  close,
  
  now,
  
  
  handle,
  sweep,
  recordAnsweredThread,
  getRecentAnsweredThreads,
  getLearnedFactsWithThreads,
  startSweeper,
  claimMessage,
  wasAnswered,
  touchThread,
  getThread,
  addThreadMessage,
  getThreadMessages,
  recordUserMessage,
  recentUserMessages,
  recordTopic,
  getTopics,
  recordGap,
  recordGapRejection,
  clearGapRejection,
  topGaps,
  unclassifiedGaps,
  setGapKind,
  gapCountsByKind,
  gapForThread,
  gapThreads,
  addLearnedFact,
  listLearnedFacts,
  getLearnedFactById,
  approvedFacts,
  setLearnedStatus,
  deleteLearnedFact,
  deleteLearnedByStatus,
  deleteLearnedRange,
  pendingCountForQuestion,
  hasCapturedSource,
  recordFeedback,
  removeFeedback,
  feedbackTotals,
  saveGuide,
  getGuide,
  setGuideMessageTs,
  getGuideByMessageTs,
  deleteGuide,
  muteThread,
  isThreadMuted,
  unmuteThread,
  recordMetric,
  metricCounts,
  lastMetricAt,
  metricDetails,
  medianLatency,
  countRecentRequests,
  recordRequest,
  getDbPrograms,
  saveSourceText,
  loadSourceText,
  saveProgram,
  deleteProgram,
  createTicket,
  getTicket,
  getTicketByThreadTs,
  updateTicketCardTs,
  claimTicket,
  unclaimTicket,
  resolveTicket,
  reopenTicket,
  closeTicket,
  getTicketsForProgram,
  MAX_THREAD_MESSAGES,
  MAX_USER_TOPICS,
  MAX_USER_MESSAGES,
  GUIDE_TTL_MS,
  CACHE_FRESH_MS,
  CACHE_IDLE_MS,
};
