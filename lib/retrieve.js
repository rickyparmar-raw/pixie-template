// Picks the parts of the corpus a question actually needs.
//
// Every answer used to ship the whole corpus — ~30k characters, of which one
// paragraph was relevant. That is mostly an accuracy problem rather than a speed
// one: the model reads 8k tokens looking for the bit that matters, and the
// measured result was 26 doc-grounded answers against 71 where it gave up on the
// docs and freestyled instead.
//
// Ranking is BM25 over chunks. Deliberately no embeddings yet — this adds no
// dependency and no latency, and the numbers it produces are what should decide
// whether a model is worth introducing.
const log = require("./log");

// Chunks below MIN read as fragments with no context; above MAX they stop being
// selective, which is the problem being solved. Prose paragraphs in the Pixl
// docs sit comfortably inside this band.
const MIN_CHUNK = 200;
const MAX_CHUNK = 900;

// Roughly 500-600 tokens of retrieved docs. Generated sections are added on top of
// this and are never counted against it — keeps prompts well inside Groq's TPM ceiling.
const DEFAULT_BUDGET = 2500;

// Standard BM25 constants. k1 damps how much a repeated term keeps helping, b
// controls how hard a long chunk gets penalised for its length.
const K1 = 1.2;
const B = 0.75;

// Words carried by nearly every question, so they say nothing about which chunk
// is the right one and just add noise to the scores.
// Contractions are listed alongside the words they contract. Punctuation is
// stripped before this runs, so "what's" arrives as "whats" — which meant the
// apostrophe form dropped "what" as filler while the contracted form kept
// "whats" as if it were meaningful, and the two hashed to different cache keys.
// Measured: "whats restoration energy" missed a cached "What's Restoration
// Energy?" for exactly this reason.
//
// Negation contractions are deliberately NOT here. "cant"/"wont" would collapse
// into the words they negate, and "can i submit" is not the same question as
// "cant i submit".
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "is", "are", "was",
  "were", "be", "been", "it", "its", "this", "that", "these", "those", "i", "im", "my", "me", "you", "your",
  "we", "our", "they", "them", "do", "does", "did", "how", "what", "when", "where", "why", "who", "can", "could",
  "should", "would", "will", "get", "got", "have", "has", "had", "not", "no", "yes", "so", "just", "pixie",
  "whats", "hows", "wheres", "whens", "whos", "whys", "thats", "theres", "heres", "ive", "ill", "youre",
  "u", "ur", "pls", "plz",
]);

// Matching was exact, so a question about "rates" scored zero against docs
// that say "rate" and the retriever handed back unrelated chunks. Deliberately
// blunter than a real stemmer: only regular plurals, and never on words short
// enough or -ss enough that folding would collide two different words.
function foldPlural(token) {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(ss|sh|ch|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us")) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(foldPlural);
}

// Splits on blank lines first, then merges neighbours that are too small to
// stand alone. Markdown headings start a new chunk and are repeated into it, so
// a chunk retrieved on its own still says what it is about.
function chunkSection(name, text) {
  const raw = (text || "").trim();
  if (!raw) return [];

  const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let heading = null;
  let buffer = "";

  const flush = () => {
    const body = buffer.trim();
    buffer = "";
    if (!body) return;
    chunks.push({ source: name, heading, text: heading && !body.startsWith(heading) ? `${heading}\n${body}` : body });
  };

  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)$/m);
    // A heading only starts a new chunk when it opens the paragraph — a "#" in
    // the middle of prose is punctuation, not structure.
    if (headingMatch && paragraph.startsWith("#")) {
      flush();
      heading = headingMatch[1].trim();
      buffer = paragraph;
      continue;
    }

    // Something far past the cap on its own can't be merged into anything; split
    // it on sentence ends so no chunk is cut mid-thought.
    if (paragraph.length > MAX_CHUNK) {
      flush();
      let piece = "";
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if (piece && piece.length + sentence.length > MAX_CHUNK) {
          buffer = piece;
          flush();
          piece = "";
        }
        piece = piece ? `${piece} ${sentence}` : sentence;
      }
      buffer = piece;
      flush();
      continue;
    }

    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK) {
      flush();
      buffer = paragraph;
    } else {
      buffer = candidate;
      if (buffer.length >= MIN_CHUNK) flush();
    }
  }

  flush();
  return chunks;
}

function chunkSections(sections) {
  return sections.flatMap(([name, text]) => chunkSection(name, text));
}

// Precomputes term frequencies once per corpus build so scoring a question is
// just a walk over the postings rather than a re-tokenisation of every chunk.
function buildIndex(chunks) {
  const docs = chunks.map((chunk) => {
    const terms = tokenize(`${chunk.heading || ""} ${chunk.text}`);
    const freq = new Map();
    for (const term of terms) freq.set(term, (freq.get(term) || 0) + 1);
    return { chunk, freq, length: terms.length };
  });

  const docFreq = new Map();
  for (const doc of docs) {
    for (const term of doc.freq.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }

  const totalLength = docs.reduce((sum, d) => sum + d.length, 0);
  return { docs, docFreq, avgLength: docs.length > 0 ? totalLength / docs.length : 0 };
}

function score(index, queryTerms) {
  const { docs, docFreq, avgLength } = index;
  const total = docs.length;

  return docs
    .map((doc) => {
      let value = 0;
      for (const term of queryTerms) {
        const tf = doc.freq.get(term);
        if (!tf) continue;
        // +1 inside the log keeps the weight positive for a term that appears in
        // every chunk, rather than letting it push a score negative.
        const idf = Math.log(1 + (total - docFreq.get(term) + 0.5) / (docFreq.get(term) + 0.5));
        const norm = tf * (K1 + 1);
        const denom = tf + K1 * (1 - B + (B * doc.length) / (avgLength || 1));
        value += idf * (norm / denom);
      }
      return { chunk: doc.chunk, value };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

// Returns the chunks worth sending, best first, stopping at the character
// budget. Empty when nothing matched — callers decide what that means.
function selectChunks(index, question, budget = DEFAULT_BUDGET) {
  const queryTerms = tokenize(question);
  if (queryTerms.length === 0) return [];

  // Stop, don't skip ahead: once the next-best chunk doesn't fit, scanning
  // past it for a smaller, lower-ranked one that does used to mean a highly
  // relevant chunk could get bumped for filler nobody asked about, just
  // because it happened to be shorter — worse context from a corpus that had
  // the real answer sitting right there.
  const selected = [];
  let used = 0;
  for (const { chunk } of score(index, queryTerms)) {
    if (used + chunk.text.length > budget) break;
    selected.push(chunk);
    used += chunk.text.length;
  }
  return selected;
}

// Assembles the string the answer prompt actually receives.
//
// `generated` is passed through whole and always first. Those sections are
// pixie's identity, the live program timeline and everything a helper taught it
// — small, authoritative, and the exact content that broke last time it got
// buried under scraped docs (see the comment in knowledge.buildCorpus). Ranking
// them against a question would eventually drop one, so they are never ranked.
//
// Falls back to the full corpus when retrieval finds nothing, because answering
// from too much context beats answering from none.
// `exclude` names sources that must not reach the model for this particular
// question, whatever retrieval thinks of them. The shop catalogue is the case
// it exists for: it scores well on any message naming something on the shelf,
// and answering "my ps5 controller is drifting" with a price is the bot talking
// over a conversation nobody invited it into.
function selectContext({ generated, index, sources, question, budget = DEFAULT_BUDGET, exclude = null }) {
  const dropped = exclude instanceof Set ? exclude : new Set(exclude || []);
  const kept = ([name]) => !dropped.has(name);

  const head = generated.filter(kept).filter(([, text]) => text).map(([name, text]) => `### ${name}\n${text}`);

  const chunks = selectChunks(index, question, budget).filter((c) => !dropped.has(c.source));
  if (chunks.length === 0) {
    log.debug("retrieve", `no chunk matched "${(question || "").slice(0, 60)}" — sending capped corpus`);
    let used = 0;
    const capped = [];
    for (const [name, text] of sources.filter(kept)) {
      if (used >= budget) break;
      const slice = text.slice(0, Math.max(200, budget - used));
      capped.push(`### ${name}\n${slice}`);
      used += slice.length;
    }
    return [...head, ...capped].join("\n\n");
  }

  // Grouped by source so the model still sees which document a passage came
  // from — citations depend on that name matching a real source.
  const bySource = new Map();
  for (const chunk of chunks) {
    if (!bySource.has(chunk.source)) bySource.set(chunk.source, []);
    bySource.get(chunk.source).push(chunk.text);
  }

  const body = [...bySource].map(([name, texts]) => `### ${name}\n${texts.join("\n\n")}`);
  return [...head, ...body].join("\n\n");
}

module.exports = {
  tokenize,
  foldPlural,
  chunkSection,
  chunkSections,
  buildIndex,
  score,
  selectChunks,
  selectContext,
  MIN_CHUNK,
  MAX_CHUNK,
  DEFAULT_BUDGET,
};
