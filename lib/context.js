

const db = require("./db");
const log = require("./log");

const SEED_LIMIT = 30;

function addToThread(threadTs, role, content, userId = null, channel = null) {
  if (!threadTs) return;
  db.addThreadMessage(threadTs, role, content, userId);
  db.touchThread(threadTs, channel, { pixieSpoke: role === "assistant" });
}

function getThreadContext(threadTs) {
  const messages = db.getThreadMessages(threadTs);
  if (messages.length === 0) return null;
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

function hasSpokenInThread(threadTs) {
  return !!db.getThread(threadTs)?.pixie_spoke;
}

async function seedFromSlack(client, channel, threadTs, botUserId, currentTs = null) {
  const existing = db.getThread(threadTs);
  if (existing?.seeded) return;

  db.touchThread(threadTs, channel, { seeded: true });

  try {
    const res = await client.conversations.replies({ channel, ts: threadTs, limit: SEED_LIMIT });
    const messages = res.messages || [];
    for (const m of messages) {
      if (currentTs && m.ts === currentTs) continue;
      const text = (m.text || "").trim();
      if (!text) continue;
      const role = m.user === botUserId || m.bot_id ? "assistant" : "user";
      db.addThreadMessage(threadTs, role, text, m.user || null);
    }
    log.debug("context", `seeded thread ${threadTs} with ${messages.length} messages`);
  } catch (e) {
    log.debug("context", `could not seed thread ${threadTs}: ${e.message}`);
  }
}

const STOPWORDS = new Set(
  ("a an the is are was were do does did how what when where why who which can could should would will i you my me" +
    " to of in on for with and or but if it its this that these those get got have has had am be been im ive dont" +
    " cant whats hows pls plz help there here about from any some so just like need want know")
    .split(" "),
);

const MAX_TOPIC_WORDS = 5;

function deriveTopic(question) {
  const words = (question || "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const topic = [...new Set(words)].slice(0, MAX_TOPIC_WORDS).join(" ");
  return topic || (question || "").slice(0, 40).trim();
}

function updateUserHistory(userId, question, wasHelpful = true) {
  const topic = deriveTopic(question);
  if (topic) db.recordTopic(userId, topic, wasHelpful);
}

function getUserContext(userId) {
  const rows = db.getTopics(userId);
  if (rows.length === 0) return null;
  return {
    recentTopics: rows.map((r) => r.topic),
    helpfulAnswers: rows.filter((r) => r.was_helpful).map((r) => r.topic),
  };
}

module.exports = {
  addToThread,
  getThreadContext,
  hasSpokenInThread,
  seedFromSlack,
  updateUserHistory,
  getUserContext,
  deriveTopic,
};
