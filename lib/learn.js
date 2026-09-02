

const db = require("./db");
const cache = require("./cache");
const log = require("./log");
const { config } = require("./config");

const llm = require("./llm");

const PENDING = "pending";
const APPROVED = "approved";

const TEACH_SEPARATOR = "::";

const MIN_CAPTURE_LENGTH = 25;
const MAX_CAPTURE_LENGTH = 1500;
const MAX_CAPTURES_PER_QUESTION = 2;

const JUDGE_MAX_TOKENS = 5;
const JUDGE_TIMEOUT_MS = 10000;

function parseTeach(text) {
  const raw = (text || "").trim();
  if (!raw) return null;

  const idx = raw.indexOf(TEACH_SEPARATOR);
  if (idx === -1) return null;

  const question = raw.slice(0, idx).trim();
  const answer = raw.slice(idx + TEACH_SEPARATOR.length).trim();
  if (!question || !answer) return null;

  return { question, answer };
}

function invalidateCorpus() {
  cache.clearCache();
  require("./knowledge").invalidate();
}

function teach({ question, answer, authorId, threadTs = null, channel = null, programId = null }) {
  const id = db.addLearnedFact({
    question,
    answer,
    authorId,
    status: APPROVED,
    sourceTs: threadTs,
    channel,
    programId,
  });
  if (id) invalidateCorpus();
  return id;
}

function captureFromThread({ question, answer, authorId, threadTs, channel, autoApprove = false }) {
  const status = autoApprove ? APPROVED : PENDING;
  const id = db.addLearnedFact({ question, answer, authorId, status, sourceTs: threadTs, channel });
  if (id && status === APPROVED) invalidateCorpus();
  return id;
}

function isCaptureWorthy(text) {
  const trimmed = (text || "").trim();
  if (trimmed.length < MIN_CAPTURE_LENGTH || trimmed.length > MAX_CAPTURE_LENGTH) return false;
  
  const withoutNoise = trimmed
    .replace(/<[@#!][^>]+>/g, "")
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  return withoutNoise.length >= MIN_CAPTURE_LENGTH;
}

async function judgeAnswer(question, replyText) {
  try {
    const { text } = await llm.complete(
      {
        baseUrl: config.intent.baseUrl,
        apiKey: config.intent.apiKey,
        model: config.intent.model,
        fallback: config.intent.fallback,
        onRateLimited: config.intent.onRateLimited,
        maxTokens: JUDGE_MAX_TOKENS,
        temperature: 0,
        thinking: { type: "disabled" },
        timeout: JUDGE_TIMEOUT_MS,
        messages: [
          {
            role: "system",
            content:
              "You check whether a Slack message answers a question. Reply with EXACTLY one word: YES or NO.\n\n" +
              "YES only when the message gives the asker information that resolves their question — a fix, an " +
              "explanation, a link with context, a direct factual reply.\n\n" +
              "NO for everything else: someone continuing the conversation, asking their own question, " +
              "reacting, joking, agreeing, guessing, or talking about something unrelated. Most messages in a " +
              "thread are NO.\n\n" +
              "When in doubt, answer NO.",
          },
          { role: "user", content: `Question: ${question}\n\nMessage: ${replyText}` },
        ],
      },
      "learn",
    );
    return text?.trim().toUpperCase().startsWith("YES") === true;
  } catch (e) {
    log.debug("learn", `capture judge failed: ${e.message}`);
    return false;
  }
}

const programs = require("./programs");

async function captureFromReply({ threadTs, replyText, authorId, channel, replyTs }) {
  
  
  return null;

  const gap = db.gapForThread(threadTs);
  if (!gap) {
    console.log("captureFromReply gap null for threadTs:", threadTs);
    return null;
  }

  if (gap.user_id && gap.user_id === authorId) return null;

  if (db.pendingCountForQuestion(gap.question) >= MAX_CAPTURES_PER_QUESTION) return null;

  const judged = await judgeAnswer(gap.question, replyText.trim());
  if (!judged) {
    console.log("captureFromReply judge false for question:", gap.question);
    return null;
  }

  const prog = programs.forChannel(channel);
  const programId = prog ? prog.id : null;

  const id = db.addLearnedFact({
    question: gap.question,
    answer: replyText.trim(),
    authorId,
    status: PENDING,
    sourceTs: replyTs,
    channel,
    programId,
  });

  if (!id) console.log("captureFromReply addLearnedFact null!");
  if (id) log.info("learn", `captured a candidate answer for: ${gap.question.slice(0, 60)}`);
  return id;
}

function pending(limit = 25, programId = null) {
  return db.listLearnedFacts(PENDING, limit, programId);
}

function approved(limit = 200, programId = null) {
  return db.listLearnedFacts(APPROVED, limit, programId);
}

function approve(id) {
  const ok = db.setLearnedStatus(id, APPROVED);
  
  if (ok) invalidateCorpus();
  return ok;
}

function forget(id) {
  const ok = db.deleteLearnedFact(id);
  if (ok) invalidateCorpus();
  return ok;
}

function forgetByStatus(status) {
  const count = db.deleteLearnedByStatus(status);
  if (count > 0) invalidateCorpus();
  return count;
}

function forgetRange(fromId, toId) {
  const count = db.deleteLearnedRange(fromId, toId);
  if (count > 0) invalidateCorpus();
  return count;
}

function corpusSection(programId = null) {
  const facts = db.approvedFacts(50, programId);
  if (facts.length === 0) return "";
  return facts.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
}

module.exports = {
  parseTeach,
  teach,
  captureFromThread,
  captureFromReply,
  judgeAnswer,
  isCaptureWorthy,
  pending,
  approved,
  approve,
  forget,
  forgetByStatus,
  forgetRange,
  corpusSection,
  PENDING,
  APPROVED,
  TEACH_SEPARATOR,
  MIN_CAPTURE_LENGTH,
  MAX_CAPTURES_PER_QUESTION,
};
