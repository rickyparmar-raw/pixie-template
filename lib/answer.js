// Grounded-answer step: one LLM call that either answers strictly from the
// knowledge corpus or declines. Transport (and retry policy) lives in llm.js.
const { config } = require("./config");
const programs = require("./programs");
const llm = require("./llm");
const brand = require("./brand");

const NONE_MARKER = "NONE";
// "the docs don't cover this" and "I can't tell what this person is even asking
// about" are different failures with different right answers. NONE still gets a
// friendly conversational reply; this one gets no reply at all — see
// lib/respond.js. It's a marker rather than prose because prose has to be
// written into a Slack message before anyone can decide it was worthless.
const UNCLEAR_MARKER = "UNCLEAR";
const MAX_TOKENS = 300;
const DEBUG_MAX_TOKENS = 700;
const FALLBACK_MAX_TOKENS = 900;
const answerFallbackWithHeadroom = config.answer.fallback
  ? { ...config.answer.fallback, maxTokens: FALLBACK_MAX_TOKENS }
  : null;

const CASUAL_EMOJI = ":yay: :hii: :byee: :thumbs-up: :yesyes: :hehehe: :awww: :lets-fucking-gooo: :upvote: :3c: :nyan: :shocked: :loll:";
const UNCLOSED_EMOJI = /:3c(?!:)/g;
const MD_BOLD = /\*\*([^*\n]+)\*\*/g;
const MD_UNDERSCORE_BOLD = /__([^_\n]+)__/g;

function linkifyHelpChannel(text, program = null) {
  const id = (program && program.helpChannel) ? program.helpChannel : config.slack.helpChannel;
  const pattern = /<?#pixl-help>?/gi;
  if (!id) return text;
  return text.replace(pattern, `<#${id}>`);
}

function normalizeEmoji(text, program = null) {
  const normalized = (text || "")
    .replace(UNCLOSED_EMOJI, ":3c:")
    .replace(MD_BOLD, "*$1*")
    .replace(MD_UNDERSCORE_BOLD, "_$1_");

  return linkifyHelpChannel(normalized, program);
}

const CODE_BLOCK = /```[\s\S]*?```|`[^`\n]{12,}`/;
const STACK_TRACE = /\b(?:Traceback \(most recent call last\)|at [\w$.]+\s*\(.*:\d+:\d+\)|[\w.]+Error:|[\w.]+Exception:|SyntaxError|ReferenceError|TypeError|NullPointerException|panic:|segmentation fault)/i;

function looksLikeCode(text) {
  return CODE_BLOCK.test(text || "") || STACK_TRACE.test(text || "");
}

// Callers pass whatever they have — a program object, a bare id string, or
// nothing. They used to be printed straight into the prompt, so a channel could
// be told it belonged to "the pixl program" (the lowercase database id) or "the
// ysws-global program". One place resolves it now, and everything downstream
// works with a real program record or null.
function resolveProgram(program) {
  if (!program) return null;
  if (typeof program === "object") return program;
  try {
    return programs.get(program);
  } catch (e) {
    return null;
  }
}

function programName(program) {
  return resolveProgram(program)?.name || "Pixl";
}

function helpChannelRef(program) {
  const id = resolveProgram(program)?.helpChannel || config.slack.helpChannel;
  return id ? `<#${id}>` : "#pixl-help";
}

function otherProgramNames(current) {
  try {
    return programs
      .all()
      .filter((p) => p.id !== "ysws-global" && (!current || p.id !== current.id))
      .map((p) => p.name)
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

// One deployment sits in every YSWS channel at once, which means "the deadline"
// is a different date depending on where it was typed. Nothing in the prompt
// used to say where pixie was — she inferred the program from whichever docs
// happened to be retrieved, and got it wrong whenever the shared docs matched
// first. This is a few lines of prompt and it is the difference between an
// answer and the wrong program's answer.
function whereYouAre(program = null, channel = null) {
  const p = resolveProgram(program);
  const here = channel ? `<#${channel}>` : "a Slack channel";
  const named = p && p.id !== "ysws-global";
  const lines = [];

  if (named) {
    const role = p.helpChannel && p.helpChannel === channel ? "the help channel for" : "one of the channels for";
    lines.push(`WHERE YOU ARE: ${here} — ${role} ${p.name}, a Hack Club YSWS program.`);
    lines.push(
      `Unless somebody names a different program, every question here is about ${p.name}. "the deadline", "the docs", "when does it launch", "how do i submit", "is it out yet" all mean ${p.name}'s.`,
    );
  } else {
    lines.push(`WHERE YOU ARE: ${here} — a channel that isn't tied to any one YSWS program.`);
    lines.push(
      "Don't assume which program someone means. If a question only makes sense for a specific program and they haven't said which one, ask them which.",
    );
  }

  const others = otherProgramNames(p);
  if (others.length > 0) {
    lines.push(
      `Other Hack Club YSWS programs exist and each has its own docs, deadlines, prizes and rules: ${others.join(", ")}.` +
        ` If somebody here is clearly asking about one of those, say it's a different program and point them at that program's channel.` +
        ` Never answer a question about one program using ${named ? `${p.name}'s` : "another program's"} documentation — the numbers and dates do not carry across.`,
    );
  }

  return lines.join("\n");
}

function programGuardrail(program = null, inHelpChannel = false) {
  const name = programName(program);
  const helpChan = helpChannelRef(program);

  const redirect = inHelpChannel
    ? `Say you're not sure — a helper in this channel will pick it up. Don't tell them to go to ${helpChan}, they're already here.`
    : `Say you're not sure and point them at ${helpChan}.`;

  return [
    `HARD RULE: you have documentation for the ${name} program, and it did NOT cover this message.`,
    `So if this turns out to be a question about ${name} specifics — deadlines, dates, whether it has launched, prizes, regions, sidequests, restoration energy, rules, how to join, how submissions work — you do NOT know the answer.`,
    `${redirect} Never invent a ${name} fact, number, date, or rule.`,
    `In particular NEVER state or imply whether ${name} has launched, is live, is out, or is still upcoming. You do not know. Saying 'yep it's live' or 'it's not out yet' is equally forbidden — both are guesses.`,
    `For anything that is NOT ${name}-specific — general coding, tools, git, math, life, small talk — just answer normally and helpfully like you would anywhere else.`,
  ].join("\n");
}

function pixlGuardrail(inHelpChannel = false) {
  return programGuardrail("Pixl", inHelpChannel);
}

const PIXL_GUARDRAIL = programGuardrail(null, false);

function timelineAuthorityRule(marker, alwaysLabel = "covered", program = null) {
  const progDesc = `${programName(program)} program itself`;

  return `- If a "Program timeline" section is present, it is the authority ONLY on questions asking specifically whether the ${progDesc} has launched, released, gone live, or about its dates/deadlines — "is it out yet", "when does it drop", "has it launched", "is it released", "how long until launch". Those are ALWAYS ${alwaysLabel} — never answer ${marker} to one, and never contradict it, no matter how it's worded. This does NOT extend to "how do i start/begin doing X" questions about a task, tool, or project (e.g. "how do i start building a PCB") — that "start" means beginning an activity, not asking whether Pixl has launched. The bare word "start" or "begin" alone must never trigger this rule on its own.`;
}

// Prices move when someone restocks and the hours behind them come off a
// stepped payout table, so lib/shop.js works both out in code and answers
// before this prompt is ever built. What reaches the model is the browsing
// case, where every number it needs is already printed next to the item.
function shopAuthorityRule() {
  return (
    '- If a shop section is present it is the only source of reward thresholds, and the hours printed beside an item are the only hours you may give. ' +
    "Never estimate a reward threshold from another item's hours or invent a payout rate. If a requested threshold is not shown, say you'll need to check."
  );
}

const VOICE = [
  "Voice: you talk like a chill teenager texting in Slack, not like customer support copy. Casual, short, contractions, lowercase is fine. Never just reformat the FAQ answer into a stiff formal sentence — say it like a real person quickly typing a reply.",
  "Punctuation: never use dashes. No em dashes, no en dashes, no ' -- '. Where you'd reach for one, use a comma, a full stop, or start a new sentence. Ordinary hyphens inside words and inside commands are fine and must be left alone.",
  `You can sprinkle in these custom Slack emoji where they genuinely fit — use 0-2 per reply, never force one in: ${CASUAL_EMOJI}`,
];

function systemPrompt(corpus, additionalContext = "", program = null, channel = null) {
  const helpChan = helpChannelRef(program);

  const parts = [
    `You are ${brand.name()}, a helper bot for Hack Club's YSWS programs and build guides. You answer questions using ONLY the documentation below.`,
    whereYouAre(program, channel),
    ...VOICE,
    "Rules:",
    `- If the documentation clearly answers the question, reply in exactly this format:\nSOURCE: <the section name the answer came from, without the ### prefix>\nANSWER: <a short, casual answer in your voice, 1-3 sentences>`,
    `- If the documentation does not clearly cover the question, reply with exactly: ${NONE_MARKER}`,
    "- Never guess, speculate, or use outside knowledge. A helper will follow up on anything the docs don't cover.",
    timelineAuthorityRule(NONE_MARKER, "covered", program),
    shopAuthorityRule(),
    "- Match by meaning, not exact wording. Someone can ask a documented question in completely different words — slang, typos, reordered, whatever — and it still counts as a match. 'Strict' means don't answer a genuinely different topic, it does NOT mean the phrasing has to resemble the docs.",
    "- Never copy or lightly reword the doc's own phrasing. Explain it fresh, in your own words, like you already knew the answer off the top of your head — not like you're reciting a lookup result. Two people asking the same thing at different times should not get back the identical sentence.",
    `- If the documentation says to ask for help in #pixl, say ${helpChan} instead — that's the actual dedicated help channel now, the docs text is just outdated on that one detail.`,
  ];

  if (additionalContext) {
    parts.push("", additionalContext);
  }

  parts.push("", "=== DOCUMENTATION ===", corpus);

  return parts.join("\n");
}

function parseReply(raw, program = null) {
  const text = (raw || "").trim();
  if (!text || text === NONE_MARKER) return null;

  const sourceMatch = text.match(/^SOURCE:\s*(.+)$/m);
  const answerMatch = text.match(/^ANSWER:\s*([\s\S]+)$/m);
  if (!answerMatch) return null;

  let rawAnswer = answerMatch[1].trim();
  rawAnswer = rawAnswer
    .replace(/\n\s*SOURCE:\s*(NONE|[^\n]+)/gi, "")
    .replace(/\n\s*ANSWER:\s*/gi, "\n")
    .trim();

  return {
    source: sourceMatch ? sourceMatch[1].trim().replace(/^#+\s*/, "") : null,
    answer: normalizeEmoji(rawAnswer, program),
  };
}

function answerOrChatPrompt(corpus, additionalContext = "", inHelpChannel = false, program = null, channel = null) {
  const name = programName(program);
  const helpChan = helpChannelRef(program);

  const parts = [
    `You are ${brand.name()}, a helper bot for Hack Club's YSWS programs and build guides.`,
    whereYouAre(program, channel),
    ...VOICE,
  ];

  parts.push(
    "Documentation is below. Work out which of these two cases you're in, and output ONLY that case:",
    "",
    "CASE 1 — the documentation covers the question. Output exactly:",
    "SOURCE: <the section name the answer came from, without the ### prefix>",
    "ANSWER: <a short, casual answer in your voice, 1-3 sentences>",
    "",
    `CASE 2 — the documentation does not cover it. Output exactly:\nSOURCE: ${NONE_MARKER}\nANSWER: <a normal, friendly reply, 1-3 sentences>`,
    "",
    "Always emit both lines. Never output a bare answer with no SOURCE line.",
    "",
    "Choosing the case:",
    "- Match by meaning, not exact wording. Someone can ask a documented question in completely different words — slang, typos, reordered, whatever — and it is still CASE 1. 'Strict' means don't answer a genuinely different topic; it does NOT mean the phrasing has to resemble the docs.",
    `- A message that's clearly asking you to explain, clarify, or expand on something YOU just said in this conversation — 'what do you mean by that', 'wym', 'huh?', 'say more about that' — is about the conversation above, not a fresh lookup. Answer it from what you actually just said, even if the 'About ${brand.name()}' section happens to share a word or two with it (e.g. 'what', 'mean'). Never let a generic identity/FAQ entry hijack a reply to your own previous message — that reads as not knowing what you just said.`,
    "- A doc section only counts as CASE 1 when it is actually ABOUT the subject being asked, not merely because it shares a word or two with the question. 'Commands', 'terminal' and 'install' show up in the git-setup docs, but a question about installing KiCad or any other third-party tool is not a git question just because both mention commands — that's CASE 2. When the conversation above already establishes what's actually being discussed and this message is a follow-up on THAT topic, stay on it rather than jumping to a differently-themed doc entry over incidental vocabulary overlap.",
    "- 'Step by step', 'actual steps', 'list it out', 'give me the exact steps', 'step two now', 'what's step 3', 'next step' and similar describe the FORMAT someone wants the answer in (or which numbered item of THEIR OWN topic they mean), not the subject. Never match a doc section just because it happens to BE a numbered list, and never treat 'step N' as an index into whichever doc section has a step N — a follow-up like 'step by step pls' or 'step two now' after a conversation about cooking chicken means 'give the chicken steps' / 'give step two of the chicken instructions', not 'go find whatever doc has a numbered list and read out its Nth item'. A subject-less follow-up like this always inherits its subject from the immediately preceding exchange in the conversation above, never from whichever doc section happens to share the requested format.",
    `- Installing, configuring or using a piece of software that isn't ${name} itself — an editor, KiCad, Fusion360, git, a package manager, anything — is general tech knowledge, CASE 2, answered like you would answer it anywhere else. It is not a ${name} doc question just because a ${name} doc happens to mention the same tool in passing.`,
    timelineAuthorityRule(NONE_MARKER, "CASE 1", program),
    shopAuthorityRule(),
    "- Greetings, small talk and anything unrelated to the docs are CASE 2.",
    "",
    "Writing a CASE 1 answer:",
    "- Never copy or lightly reword the doc's own phrasing. Explain it fresh, in your own words, like you already knew it off the top of your head — not like you're reciting a lookup result. Two people asking the same thing at different times should not get back the identical sentence.",
    `- If the documentation says to ask for help in #pixl, say ${helpChan} instead — that's the actual dedicated help channel now, the docs text is just outdated on that one detail.`,
    "",
    "Writing a CASE 2 answer:",
    `- If it's a greeting or small talk ('whats up', 'hey ${brand.name().toLowerCase()}', 'thanks'), match it — one short friendly line back. Don't turn it into a help desk prompt, don't list what you can do, don't ask them to rephrase.`,
    `- If you genuinely cannot tell what they're asking about — the message points at something ('how do i do this', 'is it working yet', 'why wont it') and there is nothing in the conversation above for it to be pointing AT — output exactly:\nSOURCE: ${NONE_MARKER}\nANSWER: ${UNCLEAR_MARKER}\nPixie then says nothing at all, which is the right answer to a message nobody could have answered. Do NOT guess a subject, do NOT ask them what they mean, do NOT list the things you could help with, and do NOT explain how to ask you better. Use this only when the subject is genuinely missing — if you can tell what they mean and simply don't know the answer, that's an ordinary CASE 2 reply.`,
    `- For anything that is NOT ${name}-specific — general coding, tools, git, math, life — just answer normally and helpfully like you would anywhere else.`,
    programGuardrail(program, inHelpChannel),
    "- Don't announce that you checked documentation, and don't apologise for what you don't have. Just talk.",
  );

  if (additionalContext) parts.push("", additionalContext);
  parts.push("", "=== DOCUMENTATION ===", corpus);

  return parts.join("\n");
}

function parseAnswerOrChat(raw, program = null) {
  const text = (raw || "").trim();
  if (!text) return null;

  const parsed = parseReply(text, program);
  if (!parsed) {
    const cleanedText = text
      .replace(/^SOURCE:\s*(NONE|[^\n]+)\n?/i, "")
      .replace(/^ANSWER:\s*/i, "")
      .trim();
    return { source: null, answer: normalizeEmoji(cleanedText, program) };
  }

  const source = parsed.source;
  const covered = source && source.trim().toUpperCase() !== NONE_MARKER;

  // Matched whole, not by prefix: "unclear on that one, but the deadline is the
  // 18th" is a real answer that happens to start with the same word.
  if (parsed.answer.trim().toUpperCase() === UNCLEAR_MARKER) {
    return { source: null, answer: "", unclear: true };
  }

  return { source: covered ? source : null, answer: parsed.answer };
}

function selectAnswerTier({ isPing = false, inHelpChannel = false } = {}) {
  if (isPing && !inHelpChannel) {
    return config.pingAnswer || config.answer;
  }
  return config.helpAnswer || config.answer;
}

function answerRequest(question, corpus, additionalContext, inHelpChannel = false, program = null, channel = null, { isPing = false } = {}) {
  const tier = selectAnswerTier({ isPing, inHelpChannel });
  const fallbackWithHeadroom = tier.fallback
    ? { ...tier.fallback, maxTokens: FALLBACK_MAX_TOKENS }
    : null;

  return {
    baseUrl: tier.baseUrl,
    apiKey: tier.apiKey,
    model: tier.model,
    fallback: fallbackWithHeadroom,
    onRateLimited: tier.onRateLimited,
    maxTokens: looksLikeCode(question) ? DEBUG_MAX_TOKENS : MAX_TOKENS,
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: answerOrChatPrompt(corpus, additionalContext, inHelpChannel, program, channel) },
      { role: "user", content: question },
    ],
  };
}

async function getAnswerOrChat(question, corpus, additionalContext = "", inHelpChannel = false, program = null, channel = null, { isPing = false } = {}) {
  if (!corpus || !corpus.trim()) return null;

  const { text } = await llm.complete(answerRequest(question, corpus, additionalContext, inHelpChannel, program, channel, { isPing }), "answer");

  return parseAnswerOrChat(text, program);
}

async function getAnswerOrChatStream(question, corpus, additionalContext = "", { onText, inHelpChannel = false, program = null, channel = null, isPing = false } = {}) {
  if (!corpus || !corpus.trim()) return null;

  let sent = "";
  const emit = (_delta, text) => {
    const marker = text.match(/ANSWER:\s*/i);
    if (!marker) {
      if (/^SOURCE:\s*/i.test(text)) return undefined;
      return undefined;
    }

    const answer = normalizeEmoji(text.slice(marker.index + marker[0].length), program).trimEnd();
    // Hold anything that could still turn out to be the "can't tell" marker.
    // Without this the word streams into the placeholder a moment before
    // parsing decides the reply should never have been written at all. Costs a
    // single chunk of latency on a real answer starting with the same letters.
    const upper = answer.toUpperCase();
    if (upper && UNCLEAR_MARKER.startsWith(upper)) return undefined;
    if (answer && answer !== sent) {
      sent = answer;
      if (onText) onText(answer);
    }
    return undefined;
  };

  const { text } = await llm.completeStream(
    answerRequest(question, corpus, additionalContext, inHelpChannel, program, channel, { isPing }),
    emit,
    "answer",
  );

  return parseAnswerOrChat(text, program);
}

async function getGroundedAnswer(question, corpus, additionalContext = "", program = null, channel = null, { isPing = false, inHelpChannel = false } = {}) {
  if (!corpus || !corpus.trim()) return null;

  const tier = selectAnswerTier({ isPing, inHelpChannel });
  const fallbackWithHeadroom = tier.fallback
    ? { ...tier.fallback, maxTokens: FALLBACK_MAX_TOKENS }
    : null;

  const { text } = await llm.complete(
    {
      baseUrl: tier.baseUrl,
      apiKey: tier.apiKey,
      model: tier.model,
      fallback: fallbackWithHeadroom,
      onRateLimited: tier.onRateLimited,
      maxTokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: systemPrompt(corpus, additionalContext, program, channel) },
        { role: "user", content: question },
      ],
    },
    "answer",
  );

  return parseReply(text, program);
}

module.exports = {
  getGroundedAnswer,
  getAnswerOrChat,
  getAnswerOrChatStream,
  parseReply,
  parseAnswerOrChat,
  systemPrompt,
  answerOrChatPrompt,
  normalizeEmoji,
  linkifyHelpChannel,
  looksLikeCode,
  NONE_MARKER,
  UNCLEAR_MARKER,
  VOICE,
  CASUAL_EMOJI,
  PIXL_GUARDRAIL,
  MAX_TOKENS,
  DEBUG_MAX_TOKENS,
  pixlGuardrail,
  programGuardrail,
  shopAuthorityRule,
  whereYouAre,
  resolveProgram,
  timelineAuthorityRule,
};
