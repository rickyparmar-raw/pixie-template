

const { config } = require("./config");
const { complete } = require("./llm");
const { looksLikeCode } = require("./answer");
const db = require("./db");
const programs = require("./programs");
const log = require("./log");

const MAX_TOKENS = 20;
const MIN_LENGTH = 5;
const TIMEOUT_MS = 10000;
const HELP_NEEDED = "HELP_NEEDED";
const CASUAL_CHAT = "CASUAL_CHAT";

const OFF_TOPIC = "OFF_TOPIC";

const HISTORY_LIMIT = 3;

function intentSystemPrompt(program = null, { scoped = false } = {}) {
  const name = typeof program === "string" ? program : program?.name || "Hack Club YSWS";

  
  
  
  const scopeRule = scoped
    ? `

There is a third verdict here, because this channel only wants ${name} answers from pixie.

Answer OFF_TOPIC when someone genuinely needs help, but with something that is NOT about ${name} — general programming, a library or framework, their own unrelated project, maths, hardware, life advice, another Hack Club program. Real question, wrong bot. A human in the channel will take it.

Use HELP_NEEDED when the question is about ${name} itself, or when general program questions are asked inside the ${name} channel (e.g. "where are the docs?", "where is the link?", "how do i submit?", "when is the deadline?", "where is the site?", "what are the rules?").

If you cannot tell whether a question is about ${name} or not, answer OFF_TOPIC. Staying out of it is free.`
    : "";

  return `You are the gate for pixie, a Slack bot in the ${name} channels at Hack Club. Pixie replies only when someone is actually asking a question or genuinely waiting for help with their project/code/setup, and stays completely silent otherwise.

You are shown the last few messages from one person, then the ONE message you have to judge. The earlier messages are context only — never judge them. Judge the final message.

The single question you are answering is: **is this person genuinely asking a question or asking the room for help/guidance right now?**

Answer HELP_NEEDED when:
- they are asking an actionable question about ${name}, project rules, guidelines, eligibility, submissions, code debugging, tooling (git, github, hackatime), build setup, or how something works (e.g. "can ii make any kind of project?", "how do i connect hackatime", "why is my build failing with TypeError")
- they are reporting their own project/code broken or stuck and asking for troubleshooting
- they are asking for input choosing between project technologies or options ("should i use godot or kaboom for this")
- their earlier messages show them actively debugging their project and this continues it ("still getting error 403", "ok that fixed the first bug but now it crashes")
- they were just given help and are asking a follow-up ("where do i put that API key")

Answer CASUAL_CHAT when:
- speaking to or addressing someone else by name or mention (e.g. "ricky i see another bug", "orpheus check this out", "hey @bob")
- venting, complaining, expressing frustration, or cursing about external apps, third-party download timeouts, OS quirks, or internet speed without asking for help with their project (e.g. "went to download taut but the linux download is timing out", "slack is lagging so bad", "my wifi is dead", "arch is driving me crazy")
- thinking out loud, riffing, banter, jokes, hypotheticals ("what if i just used 60 api keys", "imagine if...")
- narrating daily life or what they're doing without asking for help ("gonna go eat dinner", "finally finished my homework")
- opinions, rants, memes, reactions, greetings, thanks, "gg", "lets go", "fr", "w"
- rhetorical complaints with no question or request in them
- side conversations aimed at other specific people in the room
- they already got their answer and are just acknowledging ("ohhh got it thanks")

When someone is merely venting or complaining about something failing (like a random download or third-party tool) without asking how to fix it or asking for help, classify as CASUAL_CHAT.${scopeRule}

Reply with EXACTLY one word: ${scoped ? "HELP_NEEDED, CASUAL_CHAT or OFF_TOPIC" : "HELP_NEEDED or CASUAL_CHAT"}.

When you genuinely cannot tell, choose CASUAL_CHAT. A missed question costs nothing — a human answers it. A reply nobody asked for is noise in the channel.`;
}

function buildUserPrompt(message, history = []) {
  const lines = [];

  if (history.length > 0) {
    lines.push(`Their previous ${history.length} message(s), oldest first:`);
    history.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  } else {
    lines.push("They have not said anything recently — no context available.");
  }

  lines.push("", "The message to judge:", message);
  return lines.join("\n");
}

function historyFor(userId, channel, current) {
  if (!userId) return [];
  try {
    const rows = db
      .recentUserMessages(userId, { channel, limit: HISTORY_LIMIT + 1 })
      .map((r) => (r.text || "").trim())
      .filter(Boolean);

    
    
    if (rows.length > 0 && current && rows[rows.length - 1] === current.trim()) rows.pop();

    return rows.slice(-HISTORY_LIMIT);
  } catch (e) {
    log.debug("intent", `history lookup failed: ${e.message}`);
    return [];
  }
}

function scopedFor(program, addressed = false) {
  if (addressed) return false;
  if (!program) return false;
  return programs.isProgramScoped(program);
}

async function classifyIntent(
  message,
  program = null,
  { userId = null, channel = null, history = null, addressed = false } = {},
) {
  if (!message || message.length < MIN_LENGTH) return CASUAL_CHAT;

  const scoped = scopedFor(program, addressed);
  const recent = history || historyFor(userId, channel, message);

  try {
    const { text } = await complete(
      {
        baseUrl: config.intent.baseUrl,
        apiKey: config.intent.apiKey,
        model: config.intent.model,
        fallback: config.intent.fallback,
        onRateLimited: config.intent.onRateLimited,
        maxTokens: MAX_TOKENS,
        temperature: 0.3,
        thinking: { type: "disabled" },
        timeout: TIMEOUT_MS,
        messages: [
          { role: "system", content: intentSystemPrompt(program, { scoped }) },
          { role: "user", content: buildUserPrompt(message, recent) },
        ],
      },
      "intent",
    );

    const trimmed = text?.trim();
    if (trimmed?.startsWith(HELP_NEEDED)) return HELP_NEEDED;
    if (trimmed?.startsWith(CASUAL_CHAT)) return CASUAL_CHAT;
    
    
    if (trimmed?.startsWith(OFF_TOPIC)) return OFF_TOPIC;
    return null;
  } catch (e) {
    log.error("intent", "classification failed:", e.message);
    return null;
  }
}

const REACTION_ONLY = new Set(
  ("lol lmao lmfao lmaoo lmaooo rofl haha hahaha hehe ok okay okey k kk yeah yea ye yep yup nah nope no yes" +
    " same fr frfr ngl bruh bro yo hi hey hello sup wsg gm gn ty thx thanks tysm np gg ggs w l true real" +
    " nice cool sick based goated damn oof rip wow yay lets go letsgo bet sheesh finally done exactly this")
    .split(" "),
);

function stripDecoration(text) {
  return (text || "")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/<[@#!][^>]+>/g, " ")
    .replace(/<https?:\/\/[^>]+>/gi, " ")
    .trim();
}

function normalizeReaction(text) {
  return stripDecoration(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function worthClassifying(text) {
  const raw = (text || "").trim();
  if (!raw) return false;
  if (looksLikeCode(raw)) return true;

  const stripped = stripDecoration(raw);
  if (stripped.length < MIN_LENGTH) return false;

  const normalized = normalizeReaction(raw);
  if (!normalized) return false;
  if (REACTION_ONLY.has(normalized)) return false;
  
  const words = normalized.split(" ");
  if (words.length <= 3 && words.every((w) => REACTION_ONLY.has(w))) return false;

  return true;
}

const PROBLEM_WORD =
  /\b(?:broke|broken|breaks|breaking|error|errors|fail(?:s|ed|ing)?|stuck|bug|bugged|issue|crash(?:ed|ing|es)?|glitch\w*|not working|no idea|confused)\b/i;

const BROKEN_VERB =
  /\b(?:wont|won't|cant|can't|doesnt|doesn't|isnt|isn't|didnt|didn't|not)\s+(?:\w+\s+){0,2}(?:work|works|working|load|loads|loading|run|runs|running|build|building|open|opening|start|starting|render|rendering|show|showing|display|appear|appearing|find|connect|connecting|compile|compiling|save|saving|export|launch|install|update|sync|respond|responding|recognize|detect)\b/i;

const ASK_SHAPE =
  /\?|\b(?:how|what|where|why|which|when|who)\b[^.!?]{0,30}\b(?:do|does|did|can|should|would|is|are|to)\b|\b(?:should|can|could|do) i\b|\banyone know\b|\bdoes anyone\b|\bis there a way\b|\bhow to\b|\bhelp\b/i;

const MIN_REQUEST_WORDS = 3;

function wordCount(text) {
  return text.split(/\s+/).length;
}

function looksLikeHelpRequest(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (looksLikeCode(t)) return true;
  if (wordCount(t) < MIN_REQUEST_WORDS) return false;
  return PROBLEM_WORD.test(t) || BROKEN_VERB.test(t) || ASK_SHAPE.test(t);
}

module.exports = {
  classifyIntent,
  intentSystemPrompt,
  buildUserPrompt,
  scopedFor,
  worthClassifying,
  looksLikeHelpRequest,
  HISTORY_LIMIT,
  HELP_NEEDED,
  CASUAL_CHAT,
  OFF_TOPIC,
};
