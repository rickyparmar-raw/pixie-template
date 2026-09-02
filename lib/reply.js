

const knowledge = require("./knowledge");
const log = require("./log");
const { config } = require("./config");

const THINKING = "_thinking..._";

const STREAM_UPDATE_MS = 350;

const programs = require("./programs");

const DASH_ANYWHERE = /\s*[\u2014\u2013]\s*|\s+--(?=\s)\s*/g;
const DASH_LINE_END = /\s*(?:[\u2014\u2013]|--)\s*$/gm;
const DASH_LINE_START = /^\s*(?:[\u2014\u2013]|--)\s*/gm;
const CODE_SPANS = /(```[\s\S]*?```|`[^`\n]*`)/g;

function dedash(part) {
  return (
    part
      
      
      .replace(DASH_LINE_END, "")
      .replace(DASH_LINE_START, "")
      .replace(DASH_ANYWHERE, ", ")
      
      
      .replace(/,[\s,]*,/g, ",")
      .replace(/\s+,/g, ",")
      .replace(/,\s*([.!?;:)\]])/g, "$1")
      .replace(/([(\[])\s*,\s*/g, "$1")
  );
}

function plainDashes(text) {
  if (!text) return "";
  
  return String(text)
    .split(CODE_SPANS)
    .map((part, i) => (i % 2 === 1 ? part : dedash(part)))
    .join("");
}

function plainDashesInBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (block?.text?.text) return { ...block, text: { ...block.text, text: plainDashes(block.text.text) } };
    if (Array.isArray(block?.elements)) {
      return { ...block, elements: plainDashesInBlocks(block.elements) };
    }
    return block;
  });
}

function sourceLineFor(source) {
  if (!source) return "";
  const sourceName = typeof source === "object" ? source.name : source;
  let isHidden = typeof source === "object" ? !!source.hidden : false;

  if (typeof sourceName !== "string") return "";

  
  if (
    sourceName.length > 40 ||
    sourceName.includes("?") ||
    sourceName.toLowerCase().startsWith("how to") ||
    sourceName.toLowerCase().startsWith("how do")
  ) {
    return "";
  }

  if (!isHidden) {
    try {
      const allSources = knowledge.loadSources();
      const matched = allSources.find((s) => s && s.name && s.name.toLowerCase() === sourceName.toLowerCase());
      if (matched && matched.hidden) {
        isHidden = true;
      }
    } catch (_) {}
  }
  if (isHidden) return "";

  const url = knowledge.getSourceUrl(sourceName);
  if (url) {
    return `\n\n_source: <${url}|${sourceName}>_`;
  }
  return "";
}

function blocksFor(text) {
  return [{ type: "section", text: { type: "mrkdwn", text } }];
}

function postThinking(client, channel, threadTs) {
  return client.chat
    .postMessage({ channel, thread_ts: threadTs, text: THINKING })
    .then((res) => res.ts)
    .catch((e) => {
      log.debug("respond", `could not post placeholder: ${e.message}`);
      return null;
    });
}

function makeStreamWriter({ client, channel, ensurePlaceholder }) {
  let latest = "";
  let sent = "";
  let timer = null;
  let lastAt = 0;
  let inFlight = Promise.resolve();

  const flush = () => {
    timer = null;
    lastAt = Date.now();
    if (!latest || latest === sent) return;
    sent = latest;
    const text = sent;
    inFlight = inFlight
      .then(() => ensurePlaceholder())
      .then((ts) => (ts ? client.chat.update({ channel, ts, text: plainDashes(text) }) : null))
      .catch((e) => log.debug("respond", `stream update failed: ${e.message}`));
  };

  return {
    write(text) {
      latest = text;
      if (timer) return;
      timer = setTimeout(flush, Math.max(0, STREAM_UPDATE_MS - (Date.now() - lastAt)));
    },
    async settle() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
    },
  };
}

async function finalize(client, channel, threadTs, placeholder, text, { blocks = null } = {}) {
  const payload = {
    channel,
    text: plainDashes(text),
    ...(blocks ? { blocks: plainDashesInBlocks(blocks) } : {}),
  };
  const placeholderTs = await placeholder;

  if (placeholderTs) {
    try {
      await client.chat.update({ ...payload, ts: placeholderTs });
      return placeholderTs;
    } catch (e) {
      log.debug("respond", `update failed, posting fresh: ${e.message}`);
    }
  }

  const res = await client.chat.postMessage({ ...payload, thread_ts: threadTs });
  return res.ts;
}

async function discardPlaceholder(client, channel, placeholder) {
  const ts = await placeholder;
  if (ts) await client.chat.delete({ channel, ts }).catch(() => {});
}

async function flagForHumans(client, channel, messageTs, question = "", requesterId = null) {
  if (!programs.isHelpChannel(channel) || !messageTs) return;

  const prog = programs.forChannel(channel);
  if (prog && prog.posture === "passive") {
    return;
  }

  const reaction = config.escalateReaction;
  if (reaction) {
    try {
      await client.reactions?.add?.({ channel, timestamp: messageTs, name: reaction });
    } catch (e) {
      log.debug("respond", `could not flag for humans: ${e.message}`);
    }
  }

  try {
    const tickets = require("./tickets");
    await tickets.escalateTicket({
      program: prog,
      channel,
      threadTs: messageTs,
      requesterId: requesterId || "unknown",
      question: question || "Unanswered question in help channel",
      client,
    });
  } catch (e) {
    log.debug("respond", `could not escalate ticket: ${e.message}`);
  }
}

async function seedFeedbackReactions(client, channel, messageTs) {
  const reactions = config.feedbackReactions || [];
  if (!client || !channel || !messageTs || reactions.length === 0) return;
  for (const name of reactions) {
    client.reactions.add({ channel, timestamp: messageTs, name }).catch((e) => {
      log.debug("respond", `could not seed reaction ${name}: ${e.message}`);
    });
  }
}

module.exports = {
  plainDashes,
  plainDashesInBlocks,
  sourceLineFor,
  blocksFor,
  postThinking,
  makeStreamWriter,
  finalize,
  discardPlaceholder,
  flagForHumans,
  seedFeedbackReactions,
  THINKING,
  STREAM_UPDATE_MS,
};
