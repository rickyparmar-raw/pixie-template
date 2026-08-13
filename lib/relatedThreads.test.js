const test = require("node:test");
const assert = require("node:assert/strict");
const relatedThreads = require("./relatedThreads");
const db = require("./db");

test("isSimpleLookupQuestion identifies simple link and navigation lookups", () => {
  assert.equal(relatedThreads.isSimpleLookupQuestion("where is the shop"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("where do i go for the shop"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("what is the link to pixl"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("what's the website url"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("when is the deadline"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("when does pixl end"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("hi"), true);
  assert.equal(relatedThreads.isSimpleLookupQuestion("shop?"), true);
});

test("isSimpleLookupQuestion identifies direct calculation results", () => {
  assert.equal(
    relatedThreads.isSimpleLookupQuestion("how many hours for macbook", { direct: true }),
    true
  );
});

test("isSimpleLookupQuestion allows nuanced and troubleshooting questions", () => {
  assert.equal(
    relatedThreads.isSimpleLookupQuestion("how do i fix sprite rendering artifacts in Godot export"),
    false
  );
  assert.equal(
    relatedThreads.isSimpleLookupQuestion("can i change my project idea midway through the jam"),
    false
  );
  assert.equal(
    relatedThreads.isSimpleLookupQuestion("is custom hardware allowed if i built the PCB myself"),
    false
  );
});

test("tokenize cleans text and drops stop words", () => {
  const tokens = relatedThreads.tokenize("how do I fix the Godot web export error?");
  assert.ok(tokens.includes("fix"));
  assert.ok(tokens.includes("godot"));
  assert.ok(tokens.includes("web"));
  assert.ok(tokens.includes("export"));
  assert.ok(tokens.includes("error"));
  assert.ok(!tokens.includes("how"));
  assert.ok(!tokens.includes("the"));
});

test("buildSlackPermalink generates clean Slack archive URLs", () => {
  const url = relatedThreads.buildSlackPermalink("C0B6STY9G5N", "1788107539.615819");
  assert.equal(url, "https://hackclub.slack.com/archives/C0B6STY9G5N/p1788107539615819");
});

test("findRelatedThread finds past thread and ignores current active thread", async () => {
  db.open(":memory:");
  db.recordAnsweredThread({
    question: "how to fix godot web export wasm error",
    channel: "C0B6STY9G5N",
    threadTs: "1788100100.111111",
  });

  // Simple query should return null
  const simple = await relatedThreads.findRelatedThread("where is the shop", {
    currentThreadTs: "1788200000.222222",
    channel: "C0B6STY9G5N",
  });
  assert.equal(simple, null);

  // Current thread should be excluded
  const selfMatch = await relatedThreads.findRelatedThread("godot web export error", {
    currentThreadTs: "1788100100.111111",
    channel: "C0B6STY9G5N",
  });
  assert.equal(selfMatch, null);

  // Nuanced query matching past thread should return thread details
  const match = await relatedThreads.findRelatedThread("how do i fix godot web export wasm error on chrome", {
    currentThreadTs: "1788200000.222222",
    channel: "C0B6STY9G5N",
  });
  assert.notEqual(match, null);
  assert.equal(match.channel, "C0B6STY9G5N");
  assert.equal(match.threadTs, "1788100100.111111");
  assert.ok(match.permalink.includes("p1788100100111111"));

  const line = relatedThreads.formatRelatedThreadLine(match);
  assert.ok(line.includes("Related discussion:"));
  assert.ok(line.includes("view previous thread"));
});
