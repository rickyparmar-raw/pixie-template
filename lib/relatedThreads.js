

const db = require("./db");
const log = require("./log");

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers",
  "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in",
  "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't",
  "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
  "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's",
  "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs",
  "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
  "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
  "yourselves", "pixie", "pixl", "please", "pls", "thx", "thanks", "thank", "bro", "gng", "yo", "hey", "hi"
]);

const SIMPLE_LOOKUP_PATTERNS = [
  /\b(?:where\s+(?:is|can\s+i\s+find|do\s+i\s+go\s+for|to\s+go\s+for|do\s+i\s+go))\b/i,
  /\b(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:link|url|website|site|repo|channel))\b/i,
  /\b(?:link\s+to\s+shop|shop\s+link|website\s+link)\b/i,
  /\b(?:when\s+(?:is|does)\s+(?:the\s+)?(?:deadline|due\s+date|pixl\s+end|pixl\s+end\s+date))\b/i,
];

function isSimpleLookupQuestion(question, answerResult = null) {
  const q = (question || "").trim().toLowerCase();
  if (!q) return true;

  
  if (answerResult?.direct === true) return true;

  
  if (q.split(/\s+/).length <= 2) return true;

  for (const pattern of SIMPLE_LOOKUP_PATTERNS) {
    if (pattern.test(q)) return true;
  }

  return false;
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function calculateTokenSimilarity(queryTokens, targetTokens) {
  if (!queryTokens.length || !targetTokens.length) return 0;

  const querySet = new Set(queryTokens);
  const targetSet = new Set(targetTokens);

  let matchCount = 0;
  for (const token of querySet) {
    if (targetSet.has(token)) {
      matchCount++;
    }
  }

  
  if (matchCount < 2) return 0;

  const overlapRatio = (2 * matchCount) / (querySet.size + targetSet.size);
  const queryCoverage = matchCount / querySet.size;
  return Math.max(overlapRatio, queryCoverage * 0.85);
}

function buildSlackPermalink(channel, threadTs) {
  if (!channel || !threadTs) return null;
  if (!/^\d+(\.\d+)?$/.test(String(threadTs))) return null;
  const cleanTs = String(threadTs).replace(".", "");
  return `https://hackclub.slack.com/archives/${channel}/p${cleanTs}`;
}

async function findRelatedThread(question, { currentThreadTs = null, channel = null, result = null, threshold = 0.35 } = {}) {
  if (isSimpleLookupQuestion(question, result)) {
    return null;
  }

  const queryTokens = tokenize(question);
  if (queryTokens.length < 2) {
    return null;
  }

  const candidates = [];

  
  try {
    const recent = db.getRecentAnsweredThreads(200);
    for (const r of recent) {
      if (r.thread_ts && r.channel && r.thread_ts !== currentThreadTs) {
        candidates.push({
          question: r.question,
          channel: r.channel,
          threadTs: r.thread_ts,
        });
      }
    }
  } catch (err) {
    log.debug("relatedThreads", `query answered_threads failed: ${err.message}`);
  }

  
  try {
    const learned = db.getLearnedFactsWithThreads(200);
    for (const f of learned) {
      if (f.source_ts && f.channel && f.source_ts !== currentThreadTs) {
        candidates.push({
          question: f.question,
          channel: f.channel,
          threadTs: f.source_ts,
        });
      }
    }
  } catch (err) {
    log.debug("relatedThreads", `query learned facts failed: ${err.message}`);
  }

  if (!candidates.length) return null;

  let bestMatch = null;
  let highestScore = 0;

  const seenThreads = new Set();
  for (const cand of candidates) {
    const key = `${cand.channel}:${cand.threadTs}`;
    if (seenThreads.has(key)) continue;
    seenThreads.add(key);

    const candTokens = tokenize(cand.question);
    const score = calculateTokenSimilarity(queryTokens, candTokens);

    if (score >= threshold && score > highestScore) {
      highestScore = score;
      bestMatch = {
        threadTs: cand.threadTs,
        channel: cand.channel,
        matchedQuestion: cand.question,
        score,
        permalink: buildSlackPermalink(cand.channel, cand.threadTs),
      };
    }
  }

  if (bestMatch && bestMatch.permalink) {
    log.debug("relatedThreads", `found related thread: score=${bestMatch.score.toFixed(2)} matched="${bestMatch.matchedQuestion}" url=${bestMatch.permalink}`);
    return bestMatch;
  }

  return null;
}

function formatRelatedThreadLine(related) {
  if (!related?.permalink) return "";
  return `\n\n_🧵 Related discussion: <${related.permalink}|view previous thread>_`;
}

module.exports = {
  findRelatedThread,
  formatRelatedThreadLine,
  isSimpleLookupQuestion,
  calculateTokenSimilarity,
  tokenize,
  buildSlackPermalink,
};
