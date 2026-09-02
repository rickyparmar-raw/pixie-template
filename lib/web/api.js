

const db = require("../db");
const cache = require("../cache");
const learn = require("../learn");
const knowledge = require("../knowledge");
const report = require("../report");
const programs = require("../programs");
const config = require("../config").config;
const { probe } = require("../probe");
const { coverageStats, relativeTime } = require("../stats");

function buildPulse() {
  const stats = coverageStats();
  const now = Date.now();

  
  const prev = report.collect(1);
  const curr = report.collect(0);

  const delta = curr.answered.total > 0 && prev.answered.total > 0
    ? curr.coverage - prev.coverage
    : 0;

  const pendingCount = learn.pending().length;
  const knownCount = cache.cachedCount();
  const instant = stats.instant;

  return {
    coverage: stats.rate,
    coverageDelta: delta,
    answered: stats.docs + stats.chat + stats.link,
    silent: stats.silent,
    knownCold: knownCount,
    instantPercent: instant,
    queue: pendingCount,
    corpusRefreshedAt: knowledge.lastBuiltAt?.toISOString() || null,
    corpusRefreshedRelative: relativeTime(knowledge.lastBuiltAt?.getTime()),
    time: now,
  };
}

async function handleAsk(question) {
  if (!question) return { error: "empty question" };
  return probe(question);
}

function queueList() {
  const pending = learn.pending(100);
  return pending.map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    authorId: row.author_id,
    channel: row.channel,
    sourceTs: row.source_ts,
    created: row.created_at,
    createdRelative: relativeTime(row.created_at),
  }));
}

function queueApprove(id) {
  learn.approve(id);
}

function queueDrop(id) {
  learn.forget(id);
}

function queueEdit(id, question, answer) {
  if (!question || !answer) return;
  learn.forget(id);
  learn.teach({ question, answer, authorId: null });
}

function gapsList() {
  const counts = db.gapCountsByKind();
  const docs = db.topGaps(50, 30 * 24 * 60 * 60 * 1000, { kind: report.DOCS });
  const transient = db.topGaps(50, 30 * 24 * 60 * 60 * 1000, { kind: report.TRANSIENT });
  const noise = db.topGaps(50, 30 * 24 * 60 * 60 * 1000, { kind: report.NOISE });

  
  const unjudged = db.handle()
    .query("SELECT id, question, user_id, channel, message_ts, created_at FROM doc_gaps WHERE kind IS NULL ORDER BY created_at DESC LIMIT 100")
    .all()
    .map((r) => ({
      id: r.id,
      question: r.question,
      userId: r.user_id,
      channel: r.channel,
      messageTs: r.message_ts,
      created: r.created_at,
    }));

  return {
    counts: {
      docs: counts[report.DOCS] || 0,
      transient: counts[report.TRANSIENT] || 0,
      noise: counts[report.NOISE] || 0,
      unjudged: counts.unjudged || 0,
    },
    columns: {
      docs: docs.map((g) => ({ id: g.id, question: g.question, count: g.count, lastAsked: g.last_asked })),
      transient: transient.map((g) => ({ id: g.id, question: g.question, count: g.count, lastAsked: g.last_asked })),
      noise: noise.map((g) => ({ id: g.id, question: g.question, count: g.count, lastAsked: g.last_asked })),
      unjudged,
    },
  };
}

function gapsMove(id, kind) {
  if ([report.DOCS, report.TRANSIENT, report.NOISE].includes(kind)) {
    db.setGapKind(id, kind);
  }
}

async function gapsRejudge(id) {
  const row = db.handle().query("SELECT question FROM doc_gaps WHERE id = ?").get(id);
  if (!row) return { error: "not found" };
  const kind = await report.judgeGap(row.question);
  if (kind) db.setGapKind(id, kind);
  return { id, kind: kind || "unknown" };
}

function silenceList() {
  const details = db.metricDetails("silent");
  return {
    breakdown: details.map((d) => ({ reason: d.detail, count: d.count })),
    total: details.reduce((sum, d) => sum + d.count, 0),
  };
}

function knowledgeInfo() {
  const sources = knowledge.loadSources().map((s) => ({
    name: s.name,
    type: s.type,
    url: s.url,
  }));

  const corpus = knowledge.getCorpus();
  const index = knowledge.getIndex();

  return {
    sources,
    corpusLength: corpus.length,
    chunkCount: index.docs.length,
    lastBuilt: knowledge.lastBuiltAt?.toISOString() || null,
    lastBuiltRelative: relativeTime(knowledge.lastBuiltAt?.getTime()),
  };
}

function knowledgeCorpus() {
  const index = knowledge.getIndex();
  return {
    corpus: knowledge.getCorpus().slice(0, 50000),
    chunks: index.docs.map((d) => ({
      source: d.chunk.source,
      heading: d.chunk.heading || null,
      text: d.chunk.text.slice(0, 300),
      length: d.chunk.text.length,
      termCount: d.length,
    })),
  };
}

async function knowledgeRefresh() {
  
  
  await knowledge.refreshCorpus(true);
}

function cacheList() {
  const stale = cache.staleCacheEntries(db.CACHE_FRESH_MS, 20);
  const top = cache.topCached(20);

  return {
    known: cache.cachedCount(),
    stale: stale.map((r) => ({
      hash: r.question_hash,
      question: r.question,
      askCount: r.ask_count,
    })),
    top: top.map((r) => ({
      hash: r.question_hash,
      question: r.question,
      askCount: r.ask_count,
      source: r.source,
      ageMs: Date.now() - r.written_at,
      stale: Date.now() - r.written_at > db.CACHE_FRESH_MS,
    })),
  };
}

function cacheBust(hash) {
  cache.forget(hash);
}

function handleTeach(question, answer, authorId) {
  if (!question || !answer) return false;
  return learn.teach({ question, answer, authorId });
}

function reportText(week = 0) {
  return { text: report.reportText(week) };
}

let slackClient = null;

function setSlackClient(client) {
  slackClient = client;
}

async function reportPost() {
  if (!slackClient) return false;
  return report.postWeekly(slackClient);
}

function healthCheck() {
  const missing = [];
  if (!config.slack.botToken) missing.push("SLACK_BOT_TOKEN");
  return {
    models: {
      answer: config.answer.model,
      answerUrl: config.answer.baseUrl,
      intent: config.intent.model,
      vision: config.vision.model,
    },
    channels: {
      help: config.slack.helpChannel || "not set",
      faq: config.slack.faqChannels,
      autoReply: config.slack.autoReplyChannel || "not set",
      report: config.reportChannel || "not set",
    },
    admins: config.slack.adminUserIds,
    missing,
    dbPath: process.env.PIXIE_DB_PATH || "default (pixie.db)",
  };
}
function programsList() {
  return programs.all();
}

function programSave(prog) {
  if (!prog || !prog.id || !prog.name) return { error: "id and name are required" };
  programs.saveProgram(prog);
  return { ok: true, program: programs.get(prog.id) };
}

function programRemove(id) {
  if (!id) return { error: "id required" };
  programs.removeProgram(id);
  return { ok: true };
}

function programSetPosture(id, posture) {
  const existing = programs.get(id);
  if (!existing) return { error: "program not found" };
  programs.saveProgram({ ...existing, posture });
  return { ok: true, posture };
}

function ticketsList(programId = null, status = null) {
  if (programId) {
    return db.getTicketsForProgram(programId, status);
  }
  const queryStr = status
    ? "SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC LIMIT 100"
    : "SELECT * FROM tickets ORDER BY created_at DESC LIMIT 100";
  return status ? db.handle().query(queryStr).all(status) : db.handle().query(queryStr).all();
}

function ticketUpdate(id, status, assigneeId = null) {
  if (status === "claimed") {
    db.claimTicket(id, assigneeId || "admin");
  } else if (status === "unclaim") {
    db.unclaimTicket(id);
  } else if (status === "resolved") {
    db.resolveTicket(id, "resolved via admin dashboard");
  } else if (status === "reopen") {
    db.reopenTicket(id);
  } else if (status === "closed") {
    db.closeTicket(id);
  }
  return { ok: true, ticket: db.getTicket(id) };
}

function channelsList() {
  const list = programs.getChannelsList();
  return list.map((ch) => {
    let msgCount = 0;
    let ticketCount = 0;
    try {
      msgCount = db.handle().query("SELECT COUNT(*) as count FROM user_messages WHERE channel = ?").get(ch.channelId)?.count || 0;
      ticketCount = db.handle().query("SELECT COUNT(*) as count FROM tickets WHERE channel = ?").get(ch.channelId)?.count || 0;
    } catch (_) {}
    return {
      ...ch,
      msgCount,
      ticketCount,
    };
  });
}

function channelToggle(body = {}) {
  const { channelId, programId, field, value } = body;
  if (!channelId) return { error: "channelId required" };

  const prog = programs.get(programId) || (programs.all()[0] || null);
  if (!prog) return { error: "program not found" };

  if (field === "posture") {
    programs.saveProgram({ ...prog, posture: value });
  } else if (field === "ticketDestination") {
    programs.setChannelTicketDestination(prog.id, channelId);
  } else if (field === "helpChannel") {
    programs.saveProgram({ ...prog, helpChannel: value ? channelId : null });
  } else if (field === "replyEnabled") {
    programs.saveProgram({ ...prog, posture: value ? "active" : "muted" });
  }

  return { ok: true, channels: channelsList() };
}

function channelAdd(body = {}) {
  const { programId, channelId, isHelp } = body;
  if (!channelId) return { error: "channelId required" };
  const targetProgId = programId || "pixl";
  const ok = programs.addChannelToProgram(targetProgId, channelId.trim(), !!isHelp);
  return { ok, channels: channelsList() };
}

function channelRemove(programId, channelId) {
  if (!channelId) return { error: "channelId required" };
  const targetProgId = programId || "pixl";
  const ok = programs.removeChannelFromProgram(targetProgId, channelId);
  return { ok, channels: channelsList() };
}

let slackChannelsCache = { at: 0, channels: [] };

async function slackChannels() {
  if (!config.slack.botToken) {
    return { ok: false, reason: "no SLACK_BOT_TOKEN in this environment", channels: [] };
  }

  
  if (slackChannelsCache.channels.length && Date.now() - slackChannelsCache.at < 5 * 60 * 1000) {
    return { ok: true, channels: slackChannelsCache.channels };
  }

  try {
    const { WebClient } = require("@slack/web-api");
    const client = new WebClient(config.slack.botToken);
    const channels = [];
    let cursor;
    do {
      const res = await client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      for (const ch of res.channels || []) {
        channels.push({ id: ch.id, name: ch.name, isMember: !!ch.is_member });
      }
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);

    channels.sort((a, b) => a.name.localeCompare(b.name));
    slackChannelsCache = { at: Date.now(), channels };
    return { ok: true, channels };
  } catch (e) {
    return { ok: false, reason: e.message, channels: [] };
  }
}

module.exports = {
  buildPulse,
  handleAsk,
  queueList,
  queueApprove,
  queueDrop,
  queueEdit,
  gapsList,
  gapsMove,
  gapsRejudge,
  silenceList,
  knowledgeInfo,
  knowledgeCorpus,
  knowledgeRefresh,
  cacheList,
  cacheBust,
  handleTeach,
  reportText,
  reportPost,
  setSlackClient,
  healthCheck,
  programsList,
  programSave,
  programRemove,
  programSetPosture,
  ticketsList,
  ticketUpdate,
  channelsList,
  channelToggle,
  channelAdd,
  channelRemove,
  slackChannels,
};
