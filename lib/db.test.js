process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const cache = require("./cache");

db.open(":memory:");

test("claimMessage is atomic — only the first caller wins", () => {
  assert.equal(db.claimMessage("111.1", "C1"), true);
  assert.equal(db.claimMessage("111.1", "C1"), false);
  assert.equal(db.wasAnswered("111.1"), true);
  assert.equal(db.wasAnswered("999.9"), false);
});

test("thread messages come back in order and are capped", () => {
  for (let i = 0; i < db.MAX_THREAD_MESSAGES + 5; i++) {
    db.addThreadMessage("t1", "user", `msg ${i}`, "U1");
  }
  const messages = db.getThreadMessages("t1");
  assert.equal(messages.length, db.MAX_THREAD_MESSAGES);
  // Oldest trimmed, newest kept.
  assert.equal(messages.at(-1).content, `msg ${db.MAX_THREAD_MESSAGES + 4}`);
});

test("touchThread records that pixie spoke without clobbering on later writes", () => {
  db.touchThread("t2", "C1", { pixieSpoke: true });
  db.touchThread("t2", "C1", {});
  assert.equal(db.getThread("t2").pixie_spoke, 1);
});

test("user topics are capped at the most recent N", () => {
  for (let i = 0; i < db.MAX_USER_TOPICS + 4; i++) {
    db.recordTopic("U2", `topic-${i}`, true);
  }
  assert.equal(db.getTopics("U2").length, db.MAX_USER_TOPICS);
});

test("answer cache round-trips and misses on an unknown key", () => {
  cache.putCachedAnswer("hash-a", "how do i join", { source: "Pixl FAQ", answer: "just sign up" });

  const hit = cache.getCachedAnswer("hash-a");
  assert.equal(hit.source, "Pixl FAQ");
  assert.equal(hit.answer, "just sign up");
  assert.ok(hit.ageMs >= 0);
  assert.equal(cache.getCachedAnswer("hash-missing"), null);
});

// The ask count is the only record of which questions are worth remembering —
// retention and the background refresh order both key off it.
test("every hit bumps the ask count", () => {
  cache.putCachedAnswer("hash-count", "whats the deadline", { source: "Pixl FAQ", answer: "august 18" });
  assert.equal(cache.getCachedAnswer("hash-count").askCount, 1);
  assert.equal(cache.getCachedAnswer("hash-count").askCount, 2);
  assert.equal(cache.getCachedAnswer("hash-count").askCount, 3);
});

// A background refresh is pixie updating itself, not somebody asking. Counting
// it would let the warmer promote its own entries up the refresh order.
test("a refresh updates the answer without counting as an ask", () => {
  // topCached reads without bumping — getCachedAnswer counts as an ask, so it
  // can't be used to observe the count it changes.
  const countOf = (question) => cache.topCached(50).find((r) => r.question === question)?.ask_count;

  cache.putCachedAnswer("hash-refresh", "how do i submit", { source: "Pixl Docs", answer: "old answer" });
  cache.getCachedAnswer("hash-refresh");
  cache.getCachedAnswer("hash-refresh");
  const before = countOf("how do i submit");

  cache.putCachedAnswer("hash-refresh", "how do i submit", { source: "Pixl Docs", answer: "new answer" }, { refreshed: true });

  assert.equal(countOf("how do i submit"), before, "a refresh is pixie updating itself, not somebody asking");
  assert.equal(cache.getCachedAnswer("hash-refresh").answer, "new answer");
});

// The whole point of the change: an answer people keep asking for must survive
// a sweep that used to delete everything older than six hours.
test("sweep keeps a question people still ask and drops one nobody does", () => {
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000;

  cache.putCachedAnswer("hash-popular", "how do i join", { source: "Pixl FAQ", answer: "sign up" });
  cache.putCachedAnswer("hash-forgotten", "some one-off thing", { source: "Pixl Docs", answer: "whatever" });

  // Both written long ago; only one has been asked for since.
  db.handle().query("UPDATE answer_cache SET created_at = ?, last_asked_at = ? WHERE question_hash = ?").run(old, old, "hash-forgotten");
  db.handle().query("UPDATE answer_cache SET created_at = ?, last_asked_at = ? WHERE question_hash = ?").run(old, Date.now(), "hash-popular");

  db.sweep();

  assert.notEqual(cache.getCachedAnswer("hash-popular"), null, "a question still being asked must survive");
  assert.equal(cache.getCachedAnswer("hash-forgotten"), null, "a phrasing nobody has asked in a week goes");
});

// The warmer spends a limited budget, so it has to spend it on the questions
// the most people are waiting on.
test("staleCacheEntries returns the stalest most-asked first", () => {
  cache.clearCache();
  const old = Date.now() - 60 * 60 * 1000;

  cache.putCachedAnswer("s-rare", "rare question", { source: "Pixl Docs", answer: "a" });
  cache.putCachedAnswer("s-common", "common question", { source: "Pixl Docs", answer: "b" });
  cache.putCachedAnswer("s-fresh", "fresh question", { source: "Pixl Docs", answer: "c" });

  db.handle().query("UPDATE answer_cache SET refreshed_at = ? WHERE question_hash IN ('s-rare','s-common')").run(old);
  db.handle().query("UPDATE answer_cache SET ask_count = 30 WHERE question_hash = 's-common'").run();

  const stale = cache.staleCacheEntries(30 * 60 * 1000, 10);
  assert.deepEqual(
    stale.map((r) => r.question),
    ["common question", "rare question"],
    "fresh entries are left alone, and the most-asked stale one comes first",
  );
});

test("topGaps groups identical questions and counts them", () => {
  db.recordGap("Whats the deadline", "U1", "C1");
  db.recordGap("whats the deadline  ", "U2", "C1");
  db.recordGap("U2 again, separately", "U2", "C1");
  db.recordGap("something else entirely", "U3", "C1");
  db.recordGap("and another different one", "U3", "C1");

  const gaps = db.topGaps(10);

  // The deadline got two distinct askers (U1, U2) and shows up with both counts.
  const deadline = gaps.find((g) => g.question === "whats the deadline");
  assert.ok(deadline);
  assert.equal(deadline.ask_count, 2);
  assert.equal(deadline.askers, 2);

  // A one-asker question, even with two asks, is not a real gap: the docs
  // should answer what multiple people are stuck on, not what one user typed
  // twice. The two single-asker rows here both fail the min-askers threshold.
  assert.ok(!gaps.some((g) => g.question === "something else entirely"));
  assert.ok(!gaps.some((g) => g.question === "and another different one"));
});

test("feedback is one vote per user and can be changed or removed", () => {
  db.recordFeedback("m1", "U1", 1);
  db.recordFeedback("m1", "U1", -1); // same user changes their mind
  db.recordFeedback("m1", "U2", 1);

  let totals = db.feedbackTotals();
  assert.equal(totals.up, 1);
  assert.equal(totals.down, 1);

  db.removeFeedback("m1", "U1");
  totals = db.feedbackTotals();
  assert.equal(totals.down, 0);
});

test("guide state persists and clears", () => {
  db.saveGuide("t3", "git-setup", 0, "U1");
  assert.equal(db.getGuide("t3").guide_id, "git-setup");

  db.saveGuide("t3", "git-setup", 2, "U1");
  assert.equal(db.getGuide("t3").current_step, 2);

  db.deleteGuide("t3");
  assert.equal(db.getGuide("t3"), null);
});

test("guide message_ts links a posted step back to its guide", () => {
  db.saveGuide("t3-msg", "git-setup", 0, "U1");
  assert.equal(db.getGuideByMessageTs("1234.5678"), null);

  db.setGuideMessageTs("t3-msg", "1234.5678");
  const row = db.getGuideByMessageTs("1234.5678");
  assert.equal(row.thread_ts, "t3-msg");
  assert.equal(row.guide_id, "git-setup");

  // A later step's message replaces the pointer — the old ts no longer
  // resolves to anything, so a stale reaction can't match the wrong step.
  db.setGuideMessageTs("t3-msg", "9999.0001");
  assert.equal(db.getGuideByMessageTs("1234.5678"), null);
  assert.equal(db.getGuideByMessageTs("9999.0001").thread_ts, "t3-msg");

  db.deleteGuide("t3-msg");
  assert.equal(db.getGuideByMessageTs("9999.0001"), null);
});

// Deliberately a kind nothing else records. Bun runs every test file in one
// process against one in-memory database, so asserting on a real metric name
// makes this pass or fail depending on which other file ran first.
test("medianLatency returns null with no data and a value once recorded", () => {
  assert.equal(db.medianLatency("nothing_recorded"), null);
  db.recordMetric("median_fixture", 100);
  db.recordMetric("median_fixture", 200);
  db.recordMetric("median_fixture", 300);
  assert.equal(db.medianLatency("median_fixture"), 200);
});

test("rate limit counts only requests inside the window", () => {
  db.recordRequest("U9");
  db.recordRequest("U9");
  assert.equal(db.countRecentRequests("U9", 60000), 2);
  // A zero-width window can't contain anything just written.
  assert.equal(db.countRecentRequests("U9", -1), 0);
});

/* ------------------------------------------------------ recent utterances -- */

test("recentUserMessages returns the newest N, oldest first", () => {
  for (const t of ["one", "two", "three", "four"]) {
    db.recordUserMessage({ userId: "U-recent", channel: "C-recent", text: t });
  }
  const rows = db.recentUserMessages("U-recent", { channel: "C-recent", limit: 3 });
  assert.deepEqual(
    rows.map((r) => r.text),
    ["two", "three", "four"],
  );
});

// The gate asks about one channel at a time — what someone said in #pixl tells
// you nothing about whether they are stuck in #sprig-help.
test("recentUserMessages scopes to a channel when given one", () => {
  db.recordUserMessage({ userId: "U-scope", channel: "C-a", text: "in channel a" });
  db.recordUserMessage({ userId: "U-scope", channel: "C-b", text: "in channel b" });

  assert.deepEqual(
    db.recentUserMessages("U-scope", { channel: "C-a" }).map((r) => r.text),
    ["in channel a"],
  );
  assert.equal(db.recentUserMessages("U-scope", {}).length, 2);
});

// Short-term context, not history: a per-user cap keeps a chatty channel from
// growing the table without bound.
test("recentUserMessages keeps only the newest MAX_USER_MESSAGES per person", () => {
  for (let i = 0; i < db.MAX_USER_MESSAGES + 5; i++) {
    db.recordUserMessage({ userId: "U-cap", channel: "C-cap", text: `msg ${i}` });
  }
  const all = db.recentUserMessages("U-cap", { channel: "C-cap", limit: 100 });
  assert.equal(all.length, db.MAX_USER_MESSAGES);
  assert.equal(all[all.length - 1].text, `msg ${db.MAX_USER_MESSAGES + 4}`);
});

test("recentUserMessages ignores empty text and unknown users", () => {
  db.recordUserMessage({ userId: "U-empty", channel: "C-e", text: "   " });
  assert.deepEqual(db.recentUserMessages("U-empty", { channel: "C-e" }), []);
  assert.deepEqual(db.recentUserMessages(null), []);
});

test("sweep runs without error", () => {
  assert.doesNotThrow(() => db.sweep());
});

/* ------------------------------------------------------- source text cache -- */
// The docs are fetched from api.github.com, which rate-limits by IP — and on
// Railway that IP is shared with everyone else on the box. A 403 there used to
// mean "serve the last good copy", except the last good copy was a Map in
// memory: a restart during a rate-limited window left pixie with no docs at all
// until the next half-hourly refresh. This is that copy, on the volume.
test("source text survives a restart", () => {
  db.saveSourceText("Pixl Docs", "## Get\n\n50 px an hour rising to 86 px an hour");

  const stored = db.loadSourceText("Pixl Docs");
  assert.match(stored.text, /86 px an hour/);
  assert.ok(stored.fetchedAt > 0);
});

test("re-fetching a source replaces the stored copy rather than piling up", () => {
  db.saveSourceText("Rewritten", "first");
  db.saveSourceText("Rewritten", "second");

  assert.equal(db.loadSourceText("Rewritten").text, "second");
});

test("loadSourceText returns null for a source that has never been fetched", () => {
  assert.equal(db.loadSourceText("Never Fetched"), null);
});

/* -------------------------------------------------- gap ranking & rejection -- */
// The bug being fixed: a single troll asking the same question 8 times used to
// rank above 8 different people each asking once about something real. The fix
// counts distinct askers, not raw asks, and requires at least two askers
// before a question can appear on the to-do list at all.

test("topGaps requires at least two distinct askers, not just two asks", () => {
  db.handle().query("DELETE FROM doc_gaps").run();

  // One asker, eight times: not a real gap, just one user.
  for (let i = 0; i < 8; i++) db.recordGap("does pixie have a boyfriend", "U_TROLL", "C1");
  // Eight askers, once each: a real gap.
  for (const u of ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"]) {
    db.recordGap("how do i submit my project", u, "C1");
  }

  const gaps = db.topGaps(10);
  const questionText = (g) => g.question;

  assert.ok(!gaps.some((g) => questionText(g) === "does pixie have a boyfriend"),
    "one asker is not a gap regardless of how many times they ask");
  assert.ok(gaps.some((g) => questionText(g) === "how do i submit my project"),
    "eight distinct askers is a gap");
});

test("topGaps ranks by askers, not by raw asks", () => {
  db.handle().query("DELETE FROM doc_gaps").run();

  // 3 askers, 3 asks each = 9 raw asks
  for (const u of ["U1", "U2", "U3"]) for (let i = 0; i < 3; i++) db.recordGap("the real question", u, "C1");
  // 5 askers, 1 ask each = 5 raw asks
  for (const u of ["A", "B", "C", "D", "E"]) db.recordGap("the rarer question", u, "C1");

  const gaps = db.topGaps(10);
  const real = gaps.find((g) => g.question === "the real question");
  const rare = gaps.find((g) => g.question === "the rarer question");
  assert.equal(real.askers, 3);
  assert.equal(rare.askers, 5);
  // Higher asker count wins even when raw ask count would say otherwise.
  assert.ok(gaps.indexOf(rare) < gaps.indexOf(real), "rarer question ranks above louder one");
});

test("a question a maintainer has dropped stays out of the auto-ranked list", () => {
  // Other tests in this file leave gap rows behind, and since `db` is one
  // shared in-memory handle across the suite, every test that asserts
  // exact-list-length needs to start from a clean slate. A unique question
  // text would also work; this is closer to the production code path.
  db.handle().query("DELETE FROM doc_gaps").run();
  db.handle().query("DELETE FROM gap_rejections").run();

  for (const u of ["U1", "U2", "U3"]) db.recordGap("how do i submit my project", u, "C1");
  db.recordGapRejection("how do i submit my project");

  const gaps = db.topGaps(10);
  assert.ok(!gaps.some((g) => g.question === "how do i submit my project"),
    "a human-rejected question should be hidden from the auto-ranked list");
});

test("clearing a rejection brings a question back into the list", () => {
  db.handle().query("DELETE FROM doc_gaps").run();
  db.handle().query("DELETE FROM gap_rejections").run();

  for (const u of ["U1", "U2", "U3"]) db.recordGap("how do i submit my project", u, "C1");
  db.recordGapRejection("how do i submit my project");
  assert.equal(db.topGaps(10).length, 0);

  db.clearGapRejection("how do i submit my project");
  assert.equal(db.topGaps(10).length, 1);
});

test("a rejection is keyed on the normalized question, so wording doesn't matter", () => {
  db.handle().query("DELETE FROM doc_gaps").run();
  db.handle().query("DELETE FROM gap_rejections").run();

  for (const u of ["U1", "U2", "U3"]) db.recordGap("HOW do i Submit   my project", u, "C1");
  db.recordGapRejection("how do i submit my project");

  assert.equal(db.topGaps(10).length, 0);
});
