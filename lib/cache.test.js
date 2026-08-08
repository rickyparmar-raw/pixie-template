process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const cache = require("./cache");

db.open(":memory:");

// The key is a sorted set of meaningful words, not the sentence: filler and
// word order are exactly the noise that split one answer across several keys.
test("normalize collapses punctuation, case, spacing and filler", () => {
  assert.equal(cache.normalize("Whats  the DEADLINE??"), "deadline");
});

test("normalize drops user mentions so a ping does not split the key", () => {
  assert.equal(cache.normalize("<@U0PIXIE> whats the deadline"), "deadline");
});

// Contracted and apostrophised question words have to reduce the same way, or
// the same question asked two ordinary ways is two cache entries.
test("keyFor treats a contraction and its apostrophe form as one question", () => {
  assert.equal(cache.keyFor("What's Restoration Energy?"), cache.keyFor("whats restoration energy"));
  assert.equal(cache.keyFor("wheres the game"), cache.keyFor("where is the game"));
});

// The same question asked three slightly different ways should be one cache
// entry, not three.
test("keyFor is stable across wording noise", () => {
  const a = cache.keyFor("whats the deadline?");
  const b = cache.keyFor("Whats the deadline");
  const c = cache.keyFor("  whats   the  deadline!!  ");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("keyFor preserves the legacy question-only hash when program ID is omitted", () => {
  assert.equal(cache.keyFor("whats the deadline?"), "e23839cd729a3f6017fc6cbf5ef21eeb64d77cdf");
});

// This is the case the old exact-string key missed, and it is most of why the
// measured hit rate was 2.6%: one question, three phrasings, three misses.
test("keyFor survives a reworded question", () => {
  const asked = cache.keyFor("when is the deadline");
  assert.equal(cache.keyFor("the deadline is when?"), asked);
  assert.equal(cache.keyFor("deadline?"), cache.keyFor("deadline"));
});

test("keyFor differs for genuinely different questions", () => {
  assert.notEqual(cache.keyFor("whats the deadline"), cache.keyFor("where do i play"));
  // Sharing a keyword is not sharing a question.
  assert.notEqual(cache.keyFor("how do i submit my project"), cache.keyFor("can i submit late"));
});

// Every word is filler, so there is nothing to key on. Returning a key anyway
// would put "what is it" and "how do you do that" in the same cache slot and
// serve one of them the other's reply.
test("keyFor refuses a question with no meaningful words", () => {
  assert.equal(cache.normalize("what is it"), "");
  assert.equal(cache.keyFor("what is it"), null);

  cache.put("what is it", { source: "Pixl FAQ", answer: "nope" });
  assert.equal(cache.get("what is it"), null);
  assert.equal(cache.get("how do you do that"), null);
});

test("get returns null on a miss and the stored result on a hit", () => {
  assert.equal(cache.get("never asked before"), null);

  cache.put("how do i join", { source: "Pixl FAQ", answer: "just sign up at play.pixl.rsvp" });
  assert.deepEqual(cache.get("How do I join?"), {
    source: "Pixl FAQ",
    answer: "just sign up at play.pixl.rsvp",
  });
});

test("cache keeps the same normalized question isolated by program ID", () => {
  const question = "when is the deadline?";

  cache.put(question, { source: "Pixl FAQ", answer: "august 18" }, undefined, "pixl");
  cache.put(question, { source: "Sprig FAQ", answer: "september 30" }, undefined, "sprig");

  assert.notEqual(cache.keyFor(question, "pixl"), cache.keyFor(question, "sprig"));
  assert.deepEqual(cache.get(question, "pixl"), { source: "Pixl FAQ", answer: "august 18" });
  assert.deepEqual(cache.get(question, "sprig"), { source: "Sprig FAQ", answer: "september 30" });
});

/* --------------------------------------------------------- staleness -- */

// A stale answer is normally fine to serve — the warmer regenerates it behind
// the scenes, and the wording of a rule doesn't change between refreshes.
test("an aged answer is still served, so a popular question stays instant", () => {
  cache.put("how do i unlock a region", { source: "Pixl Docs", answer: "finish the sidequests" });
  db.handle()
    .query("UPDATE answer_cache SET created_at = ?, refreshed_at = ? WHERE question_hash = ?")
    .run(1, 1, cache.keyFor("how do i unlock a region"));

  assert.equal(cache.get("how do i unlock a region").answer, "finish the sidequests");
});

// Except the timeline, whose answers carry a live countdown. Yesterday's copy
// of "august 18 — in 21 days" is not merely old, it is wrong, and wrong about
// the single most-asked category.
test("an aged timeline answer is refused rather than served", () => {
  cache.put("when does pixl launch", { source: "Program timeline", answer: "august 18 — in 21 days" });
  assert.equal(cache.get("when does pixl launch").answer, "august 18 — in 21 days");

  db.handle()
    .query("UPDATE answer_cache SET created_at = ?, refreshed_at = ? WHERE question_hash = ?")
    .run(1, 1, cache.keyFor("when does pixl launch"));

  assert.equal(cache.get("when does pixl launch"), null, "a countdown must never be served from yesterday");
});

test("isVolatile matches the timeline section however it is cased", () => {
  assert.equal(cache.isVolatile("Program timeline"), true);
  assert.equal(cache.isVolatile("  program TIMELINE "), true);
  assert.equal(cache.isVolatile("Pixl FAQ"), false);
  assert.equal(cache.isVolatile(null), false);
});
