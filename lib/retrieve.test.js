const { test } = require("node:test");
const assert = require("node:assert/strict");
const retrieve = require("./retrieve");
const { tokenize } = retrieve;

const DOCS = `## Exporting sprites

Export your sprite as a PNG at native size. Do not upscale it before uploading, the game handles scaling itself.

## Restoration energy

Restoration energy, or RE, is earned by shipping approved sidequests. Each region needs a threshold of RE before it unlocks.

## Hackatime

Hackatime tracks coding time through the WakaTime extension. Point it at your Hackatime API key and dashboard URL.`;

const FAQ = `Q: When does Pixl launch?
A: The launch date has not been announced.

Q: What do I win?
A: Prizes ship to your door once your project is approved.`;

/* ---------------------------------------------------------------- chunking -- */

test("chunkSection splits on headings and keeps the heading with the body", () => {
  const chunks = retrieve.chunkSection("Pixl Docs", DOCS);

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((c) => c.heading),
    ["Exporting sprites", "Restoration energy", "Hackatime"],
  );
  assert.match(chunks[0].text, /Exporting sprites/);
  assert.match(chunks[0].text, /native size/);
  assert.equal(chunks[0].source, "Pixl Docs");
});

test("chunkSection returns nothing for empty input", () => {
  assert.deepEqual(retrieve.chunkSection("Empty", ""), []);
  assert.deepEqual(retrieve.chunkSection("Empty", "   \n\n  "), []);
  assert.deepEqual(retrieve.chunkSection("Empty", undefined), []);
});

// A chunk cut mid-sentence is worse than no chunk — the model gets a fragment
// that reads as a complete statement and answers from it.
test("chunkSection splits an oversized paragraph on sentence ends", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} explains a detail about the thing.`).join(" ");
  const chunks = retrieve.chunkSection("Long", long);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= retrieve.MAX_CHUNK, `chunk of ${chunk.text.length} exceeds the cap`);
    assert.match(chunk.text.trim(), /\.$/);
  }
});

test("chunkSection keeps every chunk under the cap for real doc shapes", () => {
  for (const chunk of retrieve.chunkSections([["Pixl Docs", DOCS], ["Pixl FAQ", FAQ]])) {
    assert.ok(chunk.text.length <= retrieve.MAX_CHUNK);
  }
});

/* --------------------------------------------------------------- retrieval -- */

const SOURCES = [
  ["Pixl Docs", DOCS],
  ["Pixl FAQ", FAQ],
];
const index = retrieve.buildIndex(retrieve.chunkSections(SOURCES));

test("selectChunks ranks the matching passage first", () => {
  const [top] = retrieve.selectChunks(index, "how do i export a sprite");
  assert.match(top.text, /native size/);
});

test("selectChunks matches a question phrased differently from the docs", () => {
  const [top] = retrieve.selectChunks(index, "what is RE and how do i earn it");
  assert.match(top.text, /Restoration energy/);
});

test("selectChunks returns nothing when no term matches", () => {
  assert.deepEqual(retrieve.selectChunks(index, "zzzz qqqq"), []);
  assert.deepEqual(retrieve.selectChunks(index, ""), []);
});

test("selectChunks respects the character budget", () => {
  const chunks = retrieve.selectChunks(index, "sprite export restoration energy hackatime", 300);
  const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
  assert.ok(total <= 300, `selected ${total} chars against a 300 budget`);
});

// Used to skip a chunk that didn't fit and keep scanning for a smaller one
// further down the ranking — so a highly relevant chunk could get bumped for
// filler nobody asked about, just because it happened to be shorter.
test("selectChunks stops at the first chunk that doesn't fit, instead of skipping ahead to a smaller lower-ranked one", () => {
  const BIG = "gizmo ".repeat(40) + "widget contraption apparatus mechanism instrument.";
  const SMALL = "gizmo mentioned once, short.";

  const localIndex = retrieve.buildIndex(retrieve.chunkSections([
    ["Big", BIG],
    ["Small", SMALL],
  ]));

  const ranked = retrieve.score(localIndex, retrieve.tokenize("gizmo"));
  assert.equal(ranked.length, 2);
  const [top, second] = ranked;
  assert.ok(top.value >= second.value, "test setup: Big must rank at or above Small");

  // Fits the lower-ranked chunk on its own, but not the top-ranked one.
  const budget = second.chunk.text.length + 5;
  assert.ok(budget < top.chunk.text.length, "test setup: top chunk must not fit in the budget");

  assert.deepEqual(retrieve.selectChunks(localIndex, "gizmo", budget), []);
});

/* ----------------------------------------------------------------- context -- */

const GENERATED = [
  ["About pixie", "Q: Who are you?\nA: I'm pixie."],
  ["Program timeline", "Pixl launches at some point."],
];

// These are the authoritative sections. Ranking them against the question would
// eventually drop one, which is exactly the failure knowledge.buildCorpus warns
// about.
test("selectContext always includes every generated section", () => {
  const context = retrieve.selectContext({
    generated: GENERATED,
    index,
    sources: SOURCES,
    question: "how do i export a sprite",
  });

  assert.match(context, /### About pixie/);
  assert.match(context, /### Program timeline/);
  assert.match(context, /native size/);
});

test("selectContext drops the source passages a question doesn't need", () => {
  const context = retrieve.selectContext({
    generated: GENERATED,
    index,
    sources: SOURCES,
    question: "how do i export a sprite",
  });

  assert.doesNotMatch(context, /Prizes ship to your door/);
  assert.ok(context.length < [...GENERATED, ...SOURCES].map(([, t]) => t).join("").length);
});

test("selectContext labels passages with the source they came from", () => {
  const context = retrieve.selectContext({
    generated: [],
    index,
    sources: SOURCES,
    question: "when does pixl launch",
  });

  assert.match(context, /### Pixl FAQ/);
});

// Too much context beats none: a question with no lexical overlap must still get
// a corpus to answer from rather than being told the docs are empty.
test("selectContext falls back to the full corpus when nothing matches", () => {
  const context = retrieve.selectContext({
    generated: GENERATED,
    index,
    sources: SOURCES,
    question: "zzzz qqqq",
  });

  assert.match(context, /native size/);
  assert.match(context, /Prizes ship to your door/);
  assert.match(context, /### About pixie/);
});

// Matching was exact, so "what are pixl rates" scored nothing against docs that
// say "rate" and the retriever returned the right PAGE but the wrong chunks of
// it — the model got a rates question with no rate in front of it and invented
// one. Folding is applied to documents and queries alike so both sides meet.
// Measured on a 16-question rates/rules/moderation set: 15/16 -> 16/16.
test("tokenize folds regular plurals so rates matches rate", () => {
  assert.deepEqual(tokenize("rates"), tokenize("rate"));
  assert.deepEqual(tokenize("pixels"), tokenize("pixel"));
  assert.deepEqual(tokenize("journals"), tokenize("journal"));
});

test("tokenize folds -es and -ies plurals", () => {
  assert.deepEqual(tokenize("batches"), tokenize("batch"));
  assert.deepEqual(tokenize("policies"), tokenize("policy"));
});

// Over-stemming is worse than under-stemming: it collides unrelated words.
test("tokenize leaves short words and double-s words alone", () => {
  assert.deepEqual(tokenize("class"), ["class"]);
  assert.deepEqual(tokenize("pass"), ["pass"]);
  assert.deepEqual(tokenize("gas"), ["gas"]);
});

// "bonuses" -> "bonus" and "houses" -> "house" need opposite rules for the same
// -ses ending, so neither folds. A missed match costs less than a collision.
test("tokenize leaves ambiguous -uses plurals unfolded", () => {
  assert.deepEqual(tokenize("bonus"), ["bonus"]);
  assert.deepEqual(tokenize("status"), ["status"]);
});
