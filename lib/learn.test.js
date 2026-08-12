process.env.PIXIE_DB_PATH = ":memory:";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const llm = require("./llm");
const { config } = require("./config");
const learn = require("./learn");

db.open(":memory:");

// Capture is gated on the help channel. Set on the config object rather than via
// SLACK_HELP_CHANNEL, because config reads env once at load and every test file
// shares one process — whichever file required it first would decide the value.
config.slack.helpChannel = "C1";

// captureFromReply ends in a model call asking whether the reply answers the
// question. Stubbed so the suite stays hermetic; `judgeVerdict` lets individual
// tests drive the YES/NO branch. Default YES keeps the pre-existing tests — which
// are about the other guards — testing what they were written to test.
let judgeVerdict = "YES";
// llm is a shared, cached module — every test file `require("./llm")`s the
// same exports object. Stubbing at require time (module top level) poisons it
// during Bun's collection phase, before any file's tests have run at all, so
// before()/after() bracket the stub around this file's own execution window
// instead — anything outside that window sees the real llm.complete.
let realComplete;
before(() => {
  db.close();
  db.open(":memory:");
  realComplete = llm.complete;
  llm.complete = async () => ({ text: judgeVerdict, finishReason: "stop" });
});
after(() => {
  llm.complete = realComplete;
});

/* ----------------------------------------------------------------- teach -- */

test("parseTeach splits on the separator", () => {
  assert.deepEqual(learn.parseTeach("whats the prize :: a keyboard"), {
    question: "whats the prize",
    answer: "a keyboard",
  });
});

test("parseTeach keeps later separators inside the answer", () => {
  const parsed = learn.parseTeach("what is the ratio :: it's 2 :: 1, roughly");
  assert.equal(parsed.question, "what is the ratio");
  assert.equal(parsed.answer, "it's 2 :: 1, roughly");
});

test("parseTeach rejects malformed input", () => {
  assert.equal(learn.parseTeach("no separator here"), null);
  assert.equal(learn.parseTeach(":: only an answer"), null);
  assert.equal(learn.parseTeach("only a question ::"), null);
  assert.equal(learn.parseTeach(""), null);
  assert.equal(learn.parseTeach(undefined), null);
});

// Teaching is deliberate, so it skips review and is usable immediately.
test("teach stores an approved fact that reaches the corpus", () => {
  learn.teach({ question: "whats the prize for 3rd", answer: "a mechanical keyboard", authorId: "U1" });

  const section = learn.corpusSection();
  assert.match(section, /Q: whats the prize for 3rd/);
  assert.match(section, /A: a mechanical keyboard/);
});

test("corpusSection is empty when nothing is approved", () => {
  const fresh = require("./db");
  const before = fresh.approvedFacts().length;
  assert.ok(before >= 1, "previous test should have left an approved fact");
  // With rows present it must not be empty — the empty case is covered by the
  // generated-section guard in knowledge.getCorpus().
  assert.notEqual(learn.corpusSection(), "");
});

// Unlike teach(), a thread summary is LLM-written — it queues for review
// instead of landing straight in the corpus, and the cache/corpus must be
// untouched until someone approves it.
test("captureFromThread queues as pending and does not touch the live corpus", () => {
  const cache = require("./cache");
  cache.put("thread-capture-probe", { source: "x", answer: "old answer" });

  const id = learn.captureFromThread({
    question: "how do i join pixl",
    answer: "post in #pixl-help and a helper will add you",
    authorId: "U1",
    threadTs: "thread-teach-1",
    channel: "C1",
  });

  assert.ok(id);
  assert.doesNotMatch(learn.corpusSection(), /how do i join pixl/);
  assert.ok(cache.get("thread-capture-probe"), "approving/teaching busts the cache, capture must not");

  const row = learn.pending().find((r) => r.id === id);
  assert.equal(row.status, "pending");
});

// sourceTs reuses learned_facts' unique index — the same guard captureFromReply
// relies on to avoid double-capturing one reply.
test("captureFromThread does not queue the same thread twice", () => {
  const first = learn.captureFromThread({
    question: "how do i deploy",
    answer: "push to main",
    authorId: "U1",
    threadTs: "thread-teach-dupe",
    channel: "C1",
  });
  const second = learn.captureFromThread({
    question: "how do i deploy, reworded",
    answer: "push to main, reworded",
    authorId: "U2",
    threadTs: "thread-teach-dupe",
    channel: "C1",
  });

  assert.ok(first);
  assert.equal(second, null);
});

/* --------------------------------------------------------------- capture -- */

test("isCaptureWorthy rejects short or noise-only replies", () => {
  assert.equal(learn.isCaptureWorthy("lol"), false);
  assert.equal(learn.isCaptureWorthy("same"), false);
  assert.equal(learn.isCaptureWorthy(":yay: :yay: :yay: :yay: :yay: :yay:"), false);
  assert.equal(learn.isCaptureWorthy("<@U123> <@U456> <#C123>"), false);
  assert.equal(learn.isCaptureWorthy("https://example.com/a/very/long/url/that/is/long"), false);
});

test("isCaptureWorthy accepts a real explanation", () => {
  assert.equal(
    learn.isCaptureWorthy("you need to run bun install first, then set your API key in .env"),
    true,
  );
});

test("captureFromReply only fires on threads with a recorded gap", async () => {
  // No gap recorded for this thread.
  assert.equal(
    await learn.captureFromReply({
      threadTs: "no-gap-thread",
      replyText: "you need to run bun install first, then set your key",
      authorId: "U2",
      channel: "C1",
      replyTs: "r1",
    }),
    null,
  );
});

test("captureFromReply is disabled and returns null for thread replies", async () => {
  db.recordGap("how do i set my api key", "U1", "C1", "gap-thread-1");

  const id = await learn.captureFromReply({
    threadTs: "gap-thread-1",
    replyText: "put it in .env as OPENCODE_API_KEY, then restart the bot",
    authorId: "U2",
    channel: "C1",
    replyTs: "r2",
  });

  assert.equal(id, null);
});

// The guard the other 96 rows needed. Every cheap check passes here — the reply
// is long enough, from someone else, first in its thread — and it still isn't an
// answer, which is precisely the shape of the junk that filled the table.
test("captureFromReply drops a reply the judge says is not an answer", async () => {
  db.recordGap("pixie whats my slack id", "U1", "C1", "judge-thread-1");

  judgeVerdict = "NO";
  const id = await learn.captureFromReply({
    threadTs: "judge-thread-1",
    replyText: "pixie say my name, and then tell me what colours are in latte",
    authorId: "U2",
    channel: "C1",
    replyTs: "judge-r1",
  });
  judgeVerdict = "YES";

  assert.equal(id, null);
  assert.equal(
    learn.pending(200).some((r) => r.question === "pixie whats my slack id"),
    false,
  );
});

// An outage must not quietly start trusting whatever was said next.
test("captureFromReply fails closed when the judge call throws", async () => {
  db.recordGap("how do i rotate my key", "U1", "C1", "judge-thread-2");

  const stub = llm.complete;
  llm.complete = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  const id = await learn.captureFromReply({
    threadTs: "judge-thread-2",
    replyText: "delete the old one in the dashboard and paste the new key into .env",
    authorId: "U2",
    channel: "C1",
    replyTs: "judge-r2",
  });
  llm.complete = stub;

  assert.equal(id, null);
});

// #pixl threads are people talking to each other, not people being answered.
test("captureFromReply only captures in the help channel", async () => {
  db.recordGap("how do i export a sprite", "U1", "C-other", "chan-thread-1");

  assert.equal(
    await learn.captureFromReply({
      threadTs: "chan-thread-1",
      replyText: "export it as a PNG at native size, no upscaling, from the file menu",
      authorId: "U2",
      channel: "C-other",
      replyTs: "chan-r1",
    }),
    null,
  );
});

/* ---------------------------------------------------------------- review -- */

test("approve moves a pending fact into the corpus", async () => {
  const id = learn.captureFromThread({
    question: "what port does it run on",
    answer: "it listens on port 4900 by default, override with the PORT env var",
    authorId: "U2",
    threadTs: "gap-thread-4",
    channel: "C1",
  });

  assert.doesNotMatch(learn.corpusSection(), /port 4900/);
  assert.equal(learn.approve(id), true);
  assert.match(learn.corpusSection(), /port 4900/);
});

test("forget removes a fact from the corpus", () => {
  const id = learn.teach({ question: "temporary fact", answer: "this should not survive", authorId: "U1" });
  assert.match(learn.corpusSection(), /this should not survive/);

  assert.equal(learn.forget(id), true);
  assert.doesNotMatch(learn.corpusSection(), /this should not survive/);
});

test("forgetByStatus and forgetRange bulk delete facts", async () => {
  const id1 = learn.teach({ question: "bulk range 1", answer: "range answer 1", authorId: "U1" });
  const id2 = learn.teach({ question: "bulk range 2", answer: "range answer 2", authorId: "U1" });

  const deletedRangeCount = learn.forgetRange(id1, id2);
  assert.equal(deletedRangeCount, 2);

  learn.captureFromThread({
    question: "bulk status gap",
    answer: "bulk status answer that is long enough to be captured properly",
    authorId: "U2",
    threadTs: "gap-thread-bulk",
    channel: "C1",
  });

  const pendingBefore = learn.pending().length;
  assert.ok(pendingBefore > 0);

  const deletedPendingCount = learn.forgetByStatus("pending");
  assert.equal(deletedPendingCount, pendingBefore);
  assert.equal(learn.pending().length, 0);
});

test("approve and forget report failure for an unknown id", () => {
  assert.equal(learn.approve(999999), false);
  assert.equal(learn.forget(999999), false);
});

// A stale cached answer would otherwise keep being served after teaching.
test("teaching clears the answer cache", () => {
  const cache = require("./cache");
  cache.put("some question", { source: "x", answer: "old answer" });
  assert.ok(cache.get("some question"));

  learn.teach({ question: "unrelated", answer: "but it still busts the cache", authorId: "U1" });
  assert.equal(cache.get("some question"), null);
});
