// Everything about getting pixie's words onto a Slack message: the placeholder,
// the streamed edits, the finished post, the vote reactions and the escalation
// marker. Split out of lib/respond.js, which now owns only the decision of what
// to say — the two together were past the 500-line ceiling.
const knowledge = require("./knowledge");
const log = require("./log");
const { config } = require("./config");

const THINKING = "_thinking..._";

// Slack's own guidance is no more than one update per second on a given
// message. 350ms keeps text feeling instant and responsive without flooding.
const STREAM_UPDATE_MS = 350;

const programs = require("./programs");

// Pixie doesn't talk in dashes. The model reaches for em dashes constantly and
// a lot of the static copy has them too, so this runs on the way out to Slack
// rather than being left to every author and every completion to remember.
//
// Only real dashes and a spaced double hyphen are touched. An ordinary hyphen
// is load-bearing everywhere else in a bot that hands out shell commands:
// turning `git commit --amend` into `git commit, amend` would be worse than
// any dash. Fenced and inline code is skipped for the same reason.
const DASH_ANYWHERE = /\s*[\u2014\u2013]\s*|\s+--(?=\s)\s*/g;
const DASH_LINE_END = /\s*(?:[\u2014\u2013]|--)\s*$/gm;
const DASH_LINE_START = /^\s*(?:[\u2014\u2013]|--)\s*/gm;
const CODE_SPANS = /(```[\s\S]*?```|`[^`\n]*`)/g;

function dedash(part) {
  return (
    part
      // Dropped rather than replaced at the edges: a line that ends in a comma
      // or starts with one reads as a typo, which is worse than the dash was.
      .replace(DASH_LINE_END, "")
      .replace(DASH_LINE_START, "")
      .replace(DASH_ANYWHERE, ", ")
      // Whatever the dash was standing next to, don't leave two marks doing
      // one mark's job.
      .replace(/,[\s,]*,/g, ",")
      .replace(/\s+,/g, ",")
      .replace(/,\s*([.!?;:)\]])/g, "$1")
      .replace(/([(\[])\s*,\s*/g, "$1")
  );
}

function plainDashes(text) {
  if (!text) return "";
  // Odd indices are the captured code spans, which are passed through whole.
  return String(text)
    .split(CODE_SPANS)
    .map((part, i) => (i % 2 === 1 ? part : dedash(part)))
    .join("");
}

// Slack blocks carry their own copy of the text, so stripping only the
// top-level `text` would leave the dashes in the part people actually read.
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

  // If source is a question string from learned facts, or too long/has question marks, skip
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

// Doc answers take ~2.5s and vision up to 30s. Posting a placeholder and
// editing it in place turns dead air into visible progress, and gives us a
// message ts to attach feedback reactions to.
//
// Deliberately NOT awaited by the caller: this is a Slack round-trip worth
// ~400ms, and awaiting it before starting the model call added that to every
// single reply for no reason. Callers hold the promise and resolve it only when
// they actually need the ts, by which point it has long since landed.
function postThinking(client, channel, threadTs) {
  return client.chat
    .postMessage({ channel, thread_ts: threadTs, text: THINKING })
    .then((res) => res.ts)
    .catch((e) => {
      log.debug("respond", `could not post placeholder: ${e.message}`);
      return null;
    });
}

// Rewrites the placeholder as the answer arrives, instead of leaving it saying
// "_thinking..._" until the whole completion lands. Measured: first token at
// ~1.5s against a p50 of 4891ms for the finished reply — that gap was dead air.
//
// Leading-edge throttle: the first fragment goes out immediately, the rest at
// most every STREAM_UPDATE_MS. Updates are chained rather than fired in
// parallel so they can't land out of order, and settle() drains the chain
// before finalize() writes the finished message over the top.
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

// Drops the placeholder on the paths that end up saying nothing.
async function discardPlaceholder(client, channel, placeholder) {
  const ts = await placeholder;
  if (ts) await client.chat.delete({ channel, ts }).catch(() => {});
}

// In the dedicated help channel, a question the docs can't answer is exactly
// the kind that needs a person. Reacting on the original message marks it for
// helpers (and for Pixorpheus's ticket flow) without posting anything.
// Configure the emoji with PIXIE_ESCALATE_REACTION; unset disables it.
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
