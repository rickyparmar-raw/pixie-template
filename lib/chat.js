// Conversational reply path. The docs answer (lib/answer.js) is always tried
// first and always wins; this is what happens when the corpus doesn't cover
// something but the person is clearly talking to pixie. Previously that was a
// dead end ("hmm not totally sure about that one") even for ordinary questions
// that have nothing to do with the docs.
//
// Deliberately ungrounded — but hard-blocked from inventing Pixl specifics,
// because that's exactly what the grounded path exists to prevent.
const { config } = require("./config");
const { complete } = require("./llm");
const { VOICE, pixlGuardrail, normalizeEmoji, looksLikeCode, MAX_TOKENS, DEBUG_MAX_TOKENS } = require("./answer");

// Not every ping is a question. "pixie ur the best" should get a one-liner, not
// a paragraph — the model handles that, but knowing whether it's a question
// lets callers decide between chatting and staying quiet.
const QUESTION_MARK = /\?/;
// The trailing `'?s?` matters: people type "whats"/"hows"/"wheres" without the
// apostrophe constantly, and a bare \bwhat\b does not match "whats".
const QUESTION_WORD =
  /\b(?:how|what|when|where|why|who|which|is|are|was|were|does|do|did)'?s?\b|\b(?:can|could|should|would|will|any|anyone|help|explain|difference|vs)\b/i;
const GREETING = /\b(?:hi|hey|hello|yo|sup|hiya|howdy|morning|gm|gn|thanks|thx|ty)\b/i;

// Used by the offline --ask path to decide whether a miss is worth a
// conversational reply. The live mention path always chats instead, since it
// is going to reply either way.
function looksLikeQuestion(text) {
  const t = (text || "").trim();
  if (!t) return false;
  return QUESTION_MARK.test(t) || QUESTION_WORD.test(t) || GREETING.test(t) || looksLikeCode(t);
}

function chatSystemPrompt(additionalContext = "", inHelpChannel = false) {
  const parts = [
    "You are pixie, a helper bot for Hack Club YSWSs and guides on how to build stuff. You're helpful and you talk like a person.",
    ...VOICE,
    "Keep it short — 1-3 sentences unless they asked something that genuinely needs more.",
    "If it's just a greeting or small talk ('whats up', 'hey pixie', 'thanks'), match it — one short friendly line back. Don't turn it into a help desk prompt, don't list what you can do, don't ask them to rephrase.",
    pixlGuardrail(inHelpChannel),
    "Don't announce that you checked documentation, and don't apologise for what you don't have. Just talk.",
  ];
  if (additionalContext) parts.push("", additionalContext);
  return parts.join("\n");
}

function debugSystemPrompt(additionalContext = "", inHelpChannel = false) {
  const parts = [
    "You are pixie, helping a Hack Clubber debug their code in Slack.",
    ...VOICE,
    "They pasted code or an error. Lead with what's wrong, then the fix. Show corrected code in a fenced block when it helps.",
    "Be concrete. If you genuinely can't tell from what's shown, say what else you'd need to see rather than guessing.",
    pixlGuardrail(inHelpChannel),
  ];
  if (additionalContext) parts.push("", additionalContext);
  return parts.join("\n");
}

// Returns the reply text, or null if the model came back empty.
async function getChatReply(message, additionalContext = "", inHelpChannel = false) {
  const isDebug = looksLikeCode(message);

  const { text } = await complete(
    {
      baseUrl: config.answer.baseUrl,
      apiKey: config.answer.apiKey,
      model: config.answer.model,
      fallback: config.answer.fallback,
      onRateLimited: config.answer.onRateLimited,
      maxTokens: isDebug ? DEBUG_MAX_TOKENS : MAX_TOKENS,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content: isDebug
            ? debugSystemPrompt(additionalContext, inHelpChannel)
            : chatSystemPrompt(additionalContext, inHelpChannel),
        },
        { role: "user", content: message },
      ],
    },
    "chat",
  );

  const reply = text?.trim();
  return reply ? normalizeEmoji(reply) : null;
}

module.exports = {
  getChatReply,
  looksLikeCode,
  looksLikeQuestion,
  chatSystemPrompt,
  debugSystemPrompt,
  QUESTION_WORD,
};
