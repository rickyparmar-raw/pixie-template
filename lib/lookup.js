

const knowledge = require("./knowledge");
const answer = require("./answer");
const cache = require("./cache");
const program = require("./program");
const programs = require("./programs");
const link = require("./link");
const db = require("./db");
const log = require("./log");
const firecrawl = require("./firecrawl");
const shop = require("./shop");
const liveShop = require("./liveShop");

const calculator = require("./calculator");
const validator = require("./validator");

const DOCS_ONLY = "docs-only";

function idOf(program) {
  if (!program) return null;
  return typeof program === "string" ? program : program.id || null;
}

function cacheHit(question, contextPrompt, programId = null) {
  if (contextPrompt) return null;
  const hit = cache.get(question, programId);
  if (!hit) return null;
  log.debug("respond", "cache hit");
  db.recordMetric("cache_hit");
  return hit;
}

function dateFallback(question, contextPrompt, prog = null) {
  const record = typeof prog === "string" ? programs.get(prog) : prog;
  const programId = idOf(record || prog);
  const milestones = record?.milestones || programs.shared().milestones;

  const direct = program.directAnswer(question, new Date(), milestones, record);
  if (direct && !contextPrompt) cache.put(question, direct, programId);
  return direct;
}

function shopAnswer(question, prog, history = "") {
  const record = typeof prog === "string" ? programs.get(prog) : prog;
  const sources = [...(record?.sources || []), ...(programs.shared().sources || [])];
  if (!sources.some((s) => s && s.type === "pixl-shop")) return null;

  const data = shop.current();
  if (!data.items.length) return null;

  const result = shop.directAnswer(question, data, { history });
  if (result) db.recordMetric("answer_shop");
  return result;
}

function liveShopAnswer(question, prog) {
  const record = typeof prog === "string" ? programs.get(prog) : prog;
  const sources = [...(record?.sources || []), ...(programs.shared().sources || [])];
  const source = sources.find((candidate) => candidate && candidate.type === "live-shop");
  if (!source) return null;

  const result = liveShop.directAnswer(question, liveShop.current(), source.minutesPerApprovedHour || 20);
  if (result) db.recordMetric("answer_live_shop");
  return result;
}

function calculatorAnswer(question, prog) {
  const record = typeof prog === "string" ? programs.get(prog) : prog;
  const sources = [...(record?.sources || []), ...(programs.shared().sources || [])];
  if (!sources.some((s) => s && s.type === "pixl-shop")) return null;

  const data = shop.current();
  const result = calculator.directAnswer(question, data);
  if (result) db.recordMetric("answer_calculator");
  return result;
}

async function repoValidatorAnswer(question) {
  const isCheckQuery = /\b(?:check|inspect|validate|review|audit|ready for submission|submission check)\b/i.test(question);
  const parsed = validator.parseGithubUrl(question);
  if (parsed && (isCheckQuery || /^\s*https?:\/\/github\.com\/[^\s]+\s*$/i.test(question))) {
    const report = await validator.validateRepository(parsed.url);
    if (report && report.ok) {
      db.recordMetric("answer_validator");
      return {
        source: "Repo Validator",
        direct: true,
        answer: validator.formatValidationReport(report),
      };
    }
  }
  return null;
}

function retrievalQuery(question, contextPrompt = "", prog = null) {
  let q = (question || "").trim();
  const progName = prog?.name || (prog?.id && prog.id !== "ysws-global" ? prog.id : "");

  const isFollowUp =
    /\b(it|that|this|they|them|how|what|why|steps|more|work|works|start|join|rules)\b/i.test(q) &&
    q.split(/\s+/).length <= 8;

  if (isFollowUp && progName && !new RegExp(`\\b${progName}\\b`, "i").test(q)) {
    q = `${q} ${progName}`;
  }

  if (isFollowUp && contextPrompt) {
    const userMatches = [...contextPrompt.matchAll(/User:\s*([^\n]+)/gi)];
    if (userMatches.length > 0) {
      const lastUserQ = userMatches[userMatches.length - 1][1].trim();
      if (lastUserQ && lastUserQ.toLowerCase() !== (question || "").trim().toLowerCase()) {
        q = `${q} ${lastUserQ}`;
      }
    }
  }

  return q;
}

async function lookupAnswer(question, contextPrompt = "", prog = null, channel = null, { isPing = false } = {}) {
  const programId = idOf(prog);
  const hit = cacheHit(question, contextPrompt, programId);
  if (hit) return hit;

  const shopped = shopAnswer(question, prog, contextPrompt);
  if (shopped) return shopped;

  const liveShopped = liveShopAnswer(question, prog);
  if (liveShopped) return liveShopped;

  const calculated = calculatorAnswer(question, prog);
  if (calculated) return calculated;

  const validated = await repoValidatorAnswer(question);
  if (validated) return validated;

  const query = retrievalQuery(question, contextPrompt, prog);
  const corpus = knowledge.getContext(query, programId);
  const result = await answer.getGroundedAnswer(question, corpus, contextPrompt, prog, channel, { isPing });
  if (result) {
    if (!contextPrompt) cache.put(question, result, programId);
    return result;
  }
  return dateFallback(question, contextPrompt, prog);
}

async function answerOrChat(
  question,
  contextPrompt = "",
  { onText = null, inHelpChannel = false, program: prog = null, channel = null, allowWebSearch = false, isPing = false } = {},
) {
  const programId = idOf(prog);
  const hit = cacheHit(question, contextPrompt, programId);
  if (hit) return hit;

  const shopped = shopAnswer(question, prog, contextPrompt);
  if (shopped) return shopped;

  const liveShopped = liveShopAnswer(question, prog);
  if (liveShopped) return liveShopped;

  const calculated = calculatorAnswer(question, prog);
  if (calculated) return calculated;

  const validated = await repoValidatorAnswer(question);
  if (validated) return validated;

  const query = retrievalQuery(question, contextPrompt, prog);
  const corpus = knowledge.getContext(query, programId);
  let result = onText
    ? await answer.getAnswerOrChatStream(question, corpus, contextPrompt, { onText, inHelpChannel, program: prog, channel, isPing })
    : await answer.getAnswerOrChat(question, corpus, contextPrompt, inHelpChannel, prog, channel, { isPing });

  if (!result?.source) {
    const direct = dateFallback(question, contextPrompt, prog);
    if (direct) return direct;

    
    if (allowWebSearch) {
      const webResults = await firecrawl.searchWeb(question).catch(() => null);
      if (webResults && webResults.length > 0) {
        const webSnippet = webResults
          .map((r) => `Title: ${r.title}\nURL: ${r.url}\n${r.markdown}`)
          .join("\n\n");
        const webContextPrompt = `${contextPrompt}\n\n=== WEB RESEARCH ===\n${webSnippet}`;
        const webResult = await answer
          .getGroundedAnswer(question, corpus, webContextPrompt, prog, channel, { isPing, inHelpChannel })
          .catch(() => null);
        if (webResult) {
          result = webResult;
        }
      }
    }
  }

  if (result?.source && !contextPrompt) cache.put(question, result, programId);
  return result;
}

function knownAnswer({ question, contextPrompt, mode, program: prog = null }) {
  if (contextPrompt) return null;
  if (link.extractUrl(question)) return null;
  if (mode === DOCS_ONLY) return null;
  return cacheHit(question, contextPrompt, idOf(prog));
}

module.exports = {
  idOf,
  cacheHit,
  shopAnswer,
  liveShopAnswer,
  dateFallback,
  retrievalQuery,
  lookupAnswer,
  answerOrChat,
  knownAnswer,
};
