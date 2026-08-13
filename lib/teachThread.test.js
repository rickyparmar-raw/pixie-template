process.env.PIXIE_DB_PATH = ":memory:";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const llm = require("./llm");
const teachThread = require("./teachThread");

// Stubbed as a namespace call (llm.complete), not destructured, so these tests
// never touch the network — same convention as lib/learn.test.js.
let completeReply = "how do i join :: post in #pixl-help and a helper will add you";
// llm is a shared, cached module — every test file `require("./llm")`s the
// same exports object. Stubbing at require time (module top level) poisons it
// during Bun's collection phase, before any file's tests have run at all, so
// before()/after() bracket the stub around this file's own execution window
// instead — anything outside that window sees the real llm.complete.
let realComplete;
before(() => {
  realComplete = llm.complete;
  llm.complete = async () => ({ text: completeReply, finishReason: "stop" });
});
after(() => {
  llm.complete = realComplete;
});

function stubClient(messages) {
  return { conversations: { replies: async () => ({ messages }) } };
}

test("buildTranscript labels bot messages as assistant and drops empty text", () => {
  const transcript = teachThread.buildTranscript([
    { text: "how do i join", user: "U1" },
    { text: "" },
    { bot_id: "B1", text: "post in #pixl-help" },
  ]);
  assert.equal(transcript, "user: how do i join\nassistant: post in #pixl-help");
});

test("summarizeThread parses the model's question :: answer reply", async () => {
  const parsed = await teachThread.summarizeThread({
    client: stubClient([
      { text: "how do i join pixl", user: "U1" },
      { bot_id: "B1", text: "post in #pixl-help and a helper will add you" },
    ]),
    channel: "C1",
    threadTs: "1.1",
  });

  assert.deepEqual(parsed, {
    question: "how do i join",
    answer: "post in #pixl-help and a helper will add you",
  });
});

test("summarizeThread declines when the model finds nothing worth teaching", async () => {
  completeReply = "NONE";
  const parsed = await teachThread.summarizeThread({
    client: stubClient([{ text: "lol same", user: "U1" }]),
    channel: "C1",
    threadTs: "2.1",
  });
  completeReply = "how do i join :: post in #pixl-help and a helper will add you";

  assert.equal(parsed, null);
});

test("summarizeThread declines when the model's reply doesn't parse", async () => {
  completeReply = "just some prose with no separator";
  const parsed = await teachThread.summarizeThread({
    client: stubClient([{ text: "how do i join", user: "U1" }]),
    channel: "C1",
    threadTs: "3.1",
  });
  completeReply = "how do i join :: post in #pixl-help and a helper will add you";

  assert.equal(parsed, null);
});

// An empty or text-free thread must not spend a model call at all.
test("summarizeThread skips the model call on a thread with no text", async () => {
  const calls = [];
  const stub = llm.complete;
  llm.complete = async (...args) => {
    calls.push(args);
    return stub(...args);
  };

  const parsed = await teachThread.summarizeThread({
    client: stubClient([{ ts: "1", user: "U1" }, { ts: "2", bot_id: "B1" }]),
    channel: "C1",
    threadTs: "4.1",
  });
  llm.complete = stub;

  assert.equal(parsed, null);
  assert.equal(calls.length, 0);
});
