// Turns a Slack thread into a teach entry, triggered by the "Teach Pixie from
// thread" message shortcut (registered in lib/commands.js). Deliberately not a
// slash command: Bolt's SlashCommand payload carries no thread_ts at all, so a
// slash command has no way to know which thread it was typed in. A message
// shortcut's payload does carry the thread, which is why this exists as its
// own trigger instead of an extension of /pixie-teach.
const { config } = require("./config");
const llm = require("./llm");
const learn = require("./learn");
const { MAX_TOKENS } = require("./answer");

const THREAD_FETCH_LIMIT = 50;
const DECLINE_MARKER = "NONE";

const SYSTEM_PROMPT = [
  "You read a Slack discussion/help thread and extract a comprehensive, reusable question-and-answer fact for an AI FAQ knowledge base.",
  "The question should clearly describe the question, problem, or topic discussed in the thread as a future user would ask it.",
  "The answer should summarize the complete solution, resolution, or explanation agreed upon in the thread as a clear, standalone factual answer (do not use pronouns like 'they said' or 'see above').",
  'Reply with EXACTLY one single line in the format: "question :: answer".',
  `If the thread has no actionable question or resolution to remember, reply with exactly "${DECLINE_MARKER}".`,
].join("\n");

function buildTranscript(messages) {
  return messages
    .filter((m) => m.text)
    .map((m) => `${m.bot_id ? "assistant" : "user"}: ${m.text}`)
    .join("\n");
}

// Returns { question, answer } or null — either the thread had nothing worth
// teaching, or the model declined, or its reply didn't parse.
async function summarizeThread({ client, channel, threadTs }) {
  const { messages } = await client.conversations.replies({ channel, ts: threadTs, limit: THREAD_FETCH_LIMIT });
  const transcript = buildTranscript(messages || []);
  if (!transcript) return null;

  const { text } = await llm.complete(
    {
      baseUrl: config.answer.baseUrl,
      apiKey: config.answer.apiKey,
      model: config.answer.model,
      fallback: config.answer.fallback,
      onRateLimited: config.answer.onRateLimited,
      maxTokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
    },
    "teach-thread",
  );

  const reply = (text || "").trim();
  if (!reply || reply.toUpperCase() === DECLINE_MARKER) return null;

  return learn.parseTeach(reply);
}

module.exports = { summarizeThread, buildTranscript, THREAD_FETCH_LIMIT };
