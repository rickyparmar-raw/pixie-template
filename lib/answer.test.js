const { test } = require("node:test");
const assert = require("node:assert/strict");
const answer = require("./answer");
const llm = require("./llm");
const { config } = require("./config");
const {
  parseReply,
  parseAnswerOrChat,
  normalizeEmoji,
  NONE_MARKER,
  pixlGuardrail,
  answerOrChatPrompt,
  systemPrompt,
  timelineAuthorityRule,
} = answer;

// The model writes `:3c` because it reads as a kaomoji, and Slack then renders
// it as literal text instead of the custom emoji.
test("normalizeEmoji closes a bare :3c", () => {
  assert.equal(normalizeEmoji("nice one :3c"), "nice one :3c:");
  assert.equal(normalizeEmoji("go for it :3c and lmk"), "go for it :3c: and lmk");
});

test("normalizeEmoji leaves an already-closed :3c: alone", () => {
  assert.equal(normalizeEmoji("all good :3c:"), "all good :3c:");
});

// Slack renders a channel in blue only as <#ID>. Every doc pixie reads writes
// the bare `#pixl-help`, so the model writes it back the same way.
test("normalizeEmoji linkifies the help channel", () => {
  const original = config.slack.helpChannel;
  try {
    config.slack.helpChannel = "C1";
    assert.equal(normalizeEmoji("ask in #pixl-help"), "ask in <#C1>");
    assert.equal(normalizeEmoji("ask in <#pixl-help>"), "ask in <#C1>");
    // An already-correct link must not be rewritten into a nested one.
    assert.equal(normalizeEmoji("ask in <#C1>"), "ask in <#C1>");

    // Unconfigured, the plain name is still the most useful thing to say.
    config.slack.helpChannel = null;
    assert.equal(normalizeEmoji("ask in #pixl-help"), "ask in #pixl-help");
  } finally {
    config.slack.helpChannel = original;
  }
});

test("normalizeEmoji handles empty input", () => {
  assert.equal(normalizeEmoji(""), "");
  assert.equal(normalizeEmoji(undefined), "");
});

// Slack mrkdwn bold is a single asterisk — **this** renders the asterisks
// literally, which the model does whenever it emphasises a date.
test("normalizeEmoji converts Markdown bold to Slack mrkdwn", () => {
  assert.equal(normalizeEmoji("drops on **august 18, 2026**"), "drops on *august 18, 2026*");
  assert.equal(normalizeEmoji("__emphasis__"), "_emphasis_");
});

test("normalizeEmoji leaves single-asterisk bold and code fences alone", () => {
  assert.equal(normalizeEmoji("already *bold*"), "already *bold*");
  assert.equal(normalizeEmoji("a * b * c"), "a * b * c");
});

test("parseReply closes a bare :3c in the answer", () => {
  const result = parseReply("SOURCE: Pixl FAQ\nANSWER: just sign up :3c");
  assert.equal(result.answer, "just sign up :3c:");
});

test("parseReply returns null for the NONE marker", () => {
  assert.equal(parseReply(NONE_MARKER), null);
  assert.equal(parseReply("  NONE  "), null);
});

test("parseReply returns null for empty or missing text", () => {
  assert.equal(parseReply(""), null);
  assert.equal(parseReply(undefined), null);
});

test("parseReply extracts source and answer", () => {
  const raw = "SOURCE: Pixl FAQ\nANSWER: Anyone can join, no team required.";
  const result = parseReply(raw);
  assert.deepEqual(result, {
    source: "Pixl FAQ",
    answer: "Anyone can join, no team required.",
  });
});

test("parseReply handles a missing SOURCE line", () => {
  const raw = "ANSWER: Just the docs, no source given.";
  const result = parseReply(raw);
  assert.deepEqual(result, {
    source: null,
    answer: "Just the docs, no source given.",
  });
});

test("parseReply returns null when there is no ANSWER line", () => {
  assert.equal(parseReply("SOURCE: Pixl FAQ"), null);
});

test("parseReply strips a leading ### from the source if the model echoes the heading", () => {
  const raw = "SOURCE: ### Pixl FAQ\nANSWER: Anyone can join.";
  const result = parseReply(raw);
  assert.deepEqual(result, { source: "Pixl FAQ", answer: "Anyone can join." });
});

/* --------------------------------------------- merged answer-or-chat parse -- */
// Three response shapes, all observed against the live model. A source means
// the corpus covered it; a null source drives recordGap/flagForHumans.

test("parseAnswerOrChat reports a grounded answer with its source", () => {
  const result = parseAnswerOrChat("SOURCE: Pixl FAQ\nANSWER: Anyone can join, no team needed.");
  assert.deepEqual(result, { source: "Pixl FAQ", answer: "Anyone can join, no team needed." });
});

// The model pads NONE with trailing spaces and separates the lines with a blank
// one. Comparing without trimming would treat "NONE  " as a real section name
// and cite a source that doesn't exist.
test("parseAnswerOrChat treats a padded NONE as uncovered", () => {
  const result = parseAnswerOrChat("SOURCE: NONE  \n\nANSWER: no clue on that one, ask a helper :hii:");
  assert.deepEqual(result, { source: null, answer: "no clue on that one, ask a helper :hii:" });
  assert.equal(parseAnswerOrChat("SOURCE: none\nANSWER: hey").source, null);
});

// Greetings come back as plain prose with no prefix at all. Dropping those sent
// a perfectly good reply to the generic fallback.
test("parseAnswerOrChat treats an unprefixed reply as conversational", () => {
  const result = parseAnswerOrChat("not much, just vibing :3c");
  assert.deepEqual(result, { source: null, answer: "not much, just vibing :3c:" });
});

test("parseAnswerOrChat returns null when the model gave us nothing", () => {
  assert.equal(parseAnswerOrChat(""), null);
  assert.equal(parseAnswerOrChat(undefined), null);
});

/* --------------------------------------------------------- streamed answer -- */

function streamOf(text) {
  return async (_options, onDelta) => {
    let seen = "";
    for (const chunk of text.match(/.{1,7}/gs) || []) {
      seen += chunk;
      if (onDelta(chunk, seen) === false) return { text: seen, stopped: true };
    }
    return { text: seen, stopped: false };
  };
}

// SOURCE: comes first, so nothing is forwarded until the ANSWER: marker lands —
// otherwise Slack would briefly show the citation machinery.
test("getAnswerOrChatStream emits the answer only, never the SOURCE line", async () => {
  const original = llm.completeStream;
  llm.completeStream = streamOf("SOURCE: Pixl FAQ\nANSWER: just sign up at play.pixl.rsvp :yay:");
  try {
    const seen = [];
    const result = await answer.getAnswerOrChatStream("how do i join", "docs", "", { onText: (t) => seen.push(t) });

    assert.ok(seen.length > 1, "should have streamed more than once");
    for (const text of seen) assert.doesNotMatch(text, /SOURCE|ANSWER:/);
    assert.equal(seen[seen.length - 1], "just sign up at play.pixl.rsvp :yay:");
    assert.deepEqual(result, { source: "Pixl FAQ", answer: "just sign up at play.pixl.rsvp :yay:" });
  } finally {
    llm.completeStream = original;
  }
});

// Greetings come back as bare prose with no SOURCE/ANSWER structure at all, so
// there is no marker to wait for and nothing streams — the reply still lands
// through the normal finish path.
test("getAnswerOrChatStream emits nothing when the model skips the ANSWER marker", async () => {
  const original = llm.completeStream;
  llm.completeStream = streamOf("not much, just vibing");
  try {
    const seen = [];
    const result = await answer.getAnswerOrChatStream("whats up", "docs", "", { onText: (t) => seen.push(t) });

    assert.deepEqual(seen, []);
    assert.deepEqual(result, { source: null, answer: "not much, just vibing" });
  } finally {
    llm.completeStream = original;
  }
});

test("getAnswerOrChatStream returns null rather than calling the model on an empty corpus", async () => {
  const original = llm.completeStream;
  llm.completeStream = async () => {
    throw new Error("should not have been called");
  };
  try {
    assert.equal(await answer.getAnswerOrChatStream("anything", "", "", { onText: () => {} }), null);
  } finally {
    llm.completeStream = original;
  }
});

/* -------------------------------------------- help-channel self-awareness -- */

// Pixie used to tell someone reading #pixl-help right now to go ask in
// #pixl-help — the guardrail's redirect line never knew which channel it was
// actually speaking in.
test("pixlGuardrail points elsewhere by default and stays local when already in the help channel", () => {
  assert.match(pixlGuardrail(false), /point them at (?:<#|#pixl-help)/);
  assert.doesNotMatch(pixlGuardrail(false), /already here/);

  assert.match(pixlGuardrail(true), /a helper in this channel will pick it up/);
  assert.match(pixlGuardrail(true), /already here/);
  assert.doesNotMatch(pixlGuardrail(true), /point them at (?:<#|#pixl-help)/);
});

// A vague follow-up to pixie's OWN previous reply ("what do u mean by that
// tho") used to get swallowed by the always-included "About pixie" identity
// section — it shares words like "what"/"mean" with the identity Q&A, so a
// question that should be answered from the thread above instead came back
// as a canned "I'm a bot running on documentation" non-answer.
test("answerOrChatPrompt tells the model not to let identity docs hijack a follow-up to its own reply", () => {
  assert.match(answerOrChatPrompt("docs", "", false), /About pixie.*section happens to share a word/s);
});

// A follow-up asking specifically for Linux install commands for KiCad got
// matched onto the git-setup docs instead — both mention "commands" and
// "terminal", but the docs section had nothing to do with what was actually
// asked. Vocabulary overlap alone must not be enough to win CASE 1.
test("answerOrChatPrompt warns against vocabulary-overlap doc matches on an unrelated topic", () => {
  const prompt = answerOrChatPrompt("docs", "", false);
  assert.match(prompt, /not merely because it shares a word or two/);
  assert.match(prompt, /installing KiCad or any other third-party tool is not a git question/);
  assert.match(prompt, /is general tech knowledge, CASE 2/);
});

// Live example: "@pixie tell me how to cook chicken" got a normal CASE 2
// answer, but the thread follow-up "actual step by step pls pixie" — no
// subject mentioned, just a request for a numbered list — matched onto the
// submit-project doc's own 5-step list instead of continuing the chicken
// answer. Shared FORMAT (both are numbered steps) is not shared SUBJECT.
test("answerOrChatPrompt warns that 'step by step' describes format, not subject, and inherits the topic from context", () => {
  const prompt = answerOrChatPrompt("docs", "", false);
  assert.match(prompt, /describe the FORMAT someone wants/);
  assert.match(prompt, /never match a doc section just because it happens to BE a numbered list/i);
  assert.match(prompt, /inherits its subject from the immediately preceding exchange/);
});

// Same thread, next message: "step two now pixie" got back item #2 of the
// submit-project doc's own numbered list, literally indexed by ordinal —
// the general "step by step" guard above wasn't explicit enough to stop the
// model from treating "step N" as "read out the Nth bullet of some doc".
test("answerOrChatPrompt explicitly rules out treating 'step N' as an index into a doc's numbered list", () => {
  const prompt = answerOrChatPrompt("docs", "", false);
  assert.match(prompt, /never treat 'step N' as an index into whichever doc section has a step N/);
});

// Live example: "how do i start pcb, what is pcb and schematics" got answered
// with the launch date instead of the actual question. "no matter how the
// question is worded" had no boundary, so a bare "start" read as "has it
// started" and hijacked a completely unrelated question.
test("timelineAuthorityRule does not let a bare 'start'/'begin' alone trigger the launch-date override", () => {
  const rule = timelineAuthorityRule(NONE_MARKER);
  assert.match(rule, /how do i start building a PCB/);
  assert.match(rule, /must never trigger this rule on its own/);
  // Named from the resolved program now, not shouted as a hardcoded "PIXL".
  assert.match(rule, /ONLY on questions asking specifically whether the Pixl program itself has launched/);
});

test("both prompt builders carry the same timeline boundary, not two copies that can drift", () => {
  assert.match(systemPrompt("docs"), /must never trigger this rule on its own/);
  assert.match(answerOrChatPrompt("docs"), /must never trigger this rule on its own/);
});

test("answerOrChatPrompt swaps in the help-channel guardrail copy", () => {
  assert.match(answerOrChatPrompt("docs", "", false), /point them at (?:<#|#pixl-help)/);
  assert.match(answerOrChatPrompt("docs", "", true), /a helper in this channel will pick it up/);
});

test("getAnswerOrChatStream threads inHelpChannel through to the actual system prompt", async () => {
  const original = llm.completeStream;
  let seenPrompt = null;
  llm.completeStream = async (options) => {
    seenPrompt = options.messages[0].content;
    return { text: "SOURCE: NONE\nANSWER: not sure on that one", stopped: false };
  };
  try {
    await answer.getAnswerOrChatStream("is it out yet", "docs", "", { onText: () => {}, inHelpChannel: true });
  } finally {
    llm.completeStream = original;
  }

  assert.match(seenPrompt, /a helper in this channel will pick it up/);
});

/* ------------------------------------------------------------ whereYouAre -- */
// One deployment sits in every YSWS channel at once, so "the deadline" means a
// different date depending on where it was typed. Nothing used to tell the
// model where it was.

test("whereYouAre names the channel and the program that owns it", () => {
  const block = answer.whereYouAre({ id: "pixl", name: "Pixl", helpChannel: "C-help" }, "C-help");
  assert.match(block, /<#C-help>/);
  assert.match(block, /the help channel for Pixl/);
  assert.match(block, /every question here is about Pixl/);
});

test("whereYouAre distinguishes a program's other channels from its help channel", () => {
  const block = answer.whereYouAre({ id: "pixl", name: "Pixl", helpChannel: "C-help" }, "C-chat");
  assert.match(block, /one of the channels for Pixl/);
  assert.doesNotMatch(block, /the help channel for Pixl/);
});

// A channel nobody has claimed must not be told it belongs to a program —
// guessing there is exactly how one program's dates end up answering another's
// question.
test("whereYouAre refuses to assume a program in an unowned channel", () => {
  const block = answer.whereYouAre(null, "C-random");
  assert.match(block, /isn't tied to any one YSWS program/);
  assert.match(block, /ask them which/);
  assert.doesNotMatch(block, /every question here is about/);
});

test("whereYouAre survives having no channel to name", () => {
  const block = answer.whereYouAre({ id: "pixl", name: "Pixl" }, null);
  assert.match(block, /a Slack channel/);
  assert.doesNotMatch(block, /undefined/);
});

// The bug this replaced: callers passed the id string, and the prompt printed
// it verbatim — channels were told they belonged to "the pixl program".
test("a bare program id resolves to the program's real name, not the id", () => {
  const resolved = answer.resolveProgram("ysws-global");
  assert.equal(resolved.name, "YSWS Global");
  assert.equal(answer.resolveProgram(null), null);
});

test("both prompts carry the where-you-are block", () => {
  const prog = { id: "pixl", name: "Pixl", helpChannel: "C-help" };
  assert.match(answer.systemPrompt("docs", "", prog, "C-help"), /WHERE YOU ARE: <#C-help>/);
  assert.match(answer.answerOrChatPrompt("docs", "", true, prog, "C-help"), /WHERE YOU ARE: <#C-help>/);
});

// "eh how do i do tthis ?" got back forty words: a question, then a menu of
// things pixie could help with, then an offer to walk them through it. Nobody
// had addressed pixie and nobody could have answered that message, so the right
// reply was nothing at all. The model is given a way to say exactly that —
// a marker, not prose — because prose has to be posted somewhere before anyone
// can decide it was worthless.
test("answerOrChatPrompt gives the model a way to say it cannot tell what is being asked", () => {
  const prompt = answerOrChatPrompt("docs", "", false);
  assert.match(prompt, /cannot tell what they.re asking about/i);
  assert.match(prompt, new RegExp(`ANSWER: ${answer.UNCLEAR_MARKER}`));
  assert.match(prompt, /says nothing at all/i);
});

test("parseAnswerOrChat turns the unclear marker into no answer at all", () => {
  const parsed = answer.parseAnswerOrChat(`SOURCE: NONE\nANSWER: ${answer.UNCLEAR_MARKER}`);
  assert.equal(parsed.unclear, true);
  assert.equal(parsed.answer, "");
  assert.equal(parsed.source, null);
});

// An ordinary reply must not be mistaken for the marker just because it opens
// with the same letters.
test("parseAnswerOrChat leaves an ordinary reply alone", () => {
  const parsed = answer.parseAnswerOrChat("SOURCE: NONE\nANSWER: unclear on that one, but the deadline is the 18th");
  assert.equal(parsed.unclear, undefined);
  assert.match(parsed.answer, /deadline/);
});

// Prices are live and the hours behind them come off a stepped payout table.
// lib/shop.js works those out in code and answers before the model is called,
// so the only thing left for the model to do here is read the numbers that are
// already printed — arithmetic is exactly where it goes wrong.
test("the prompts forbid working out shop numbers by hand", () => {
  for (const prompt of [
    answer.systemPrompt("corpus"),
    answer.answerOrChatPrompt("corpus", "", false),
  ]) {
    assert.match(prompt, /only source of reward thresholds/);
    assert.match(prompt, /never estimate a reward threshold/i);
  }
});

// Stripping dashes on the way out works, but it leaves mechanical commas where
// the model meant a dash. Telling it not to reach for one in the first place is
// what actually makes the replies read right.
test("the voice rules forbid dashes outright", () => {
  for (const prompt of [answer.systemPrompt("corpus"), answer.answerOrChatPrompt("corpus", "", false)]) {
    assert.match(prompt, /never use (?:em )?dashes|no dashes/i);
  }
});
