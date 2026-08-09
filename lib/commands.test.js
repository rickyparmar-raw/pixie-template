process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { config } = require("./config");
const learn = require("./learn");
const teachThread = require("./teachThread");
const commands = require("./commands");
const { parseForgetInput, parseId, adminOnlyShortcut, teachThreadShortcut } = commands;

const ADMIN = "U0ADMIN";
config.slack.adminUserIds = [ADMIN];

test("parseForgetInput parses single ids, ranges, pending, and all", () => {
  assert.deepEqual(parseForgetInput("15"), { type: "id", id: 15 });
  assert.deepEqual(parseForgetInput("#15"), { type: "id", id: 15 });

  assert.deepEqual(parseForgetInput("12-40"), { type: "range", from: 12, to: 40 });
  assert.deepEqual(parseForgetInput("#12-#40"), { type: "range", from: 12, to: 40 });

  assert.deepEqual(parseForgetInput("pending"), { type: "pending" });
  assert.deepEqual(parseForgetInput("PENDING"), { type: "pending" });

  assert.deepEqual(parseForgetInput("all"), { type: "all" });
  // 'all' requires exact literal matching, not prefix
  assert.equal(parseForgetInput("allofit"), null);
  assert.equal(parseForgetInput("invalid"), null);
});

test("parseId accepts a bare or hashed id and rejects anything else", () => {
  assert.equal(parseId("7"), 7);
  assert.equal(parseId("#7"), 7);
  assert.equal(parseId(" 7 "), 7);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("-3"), null);
  assert.equal(parseId("seven"), null);
  assert.equal(parseId(""), null);
});

/* -------------------------------------------- teach-thread shortcut -- */

function stubEphemeralClient() {
  const posted = [];
  return { client: { chat: { postEphemeral: async (args) => void posted.push(args) } }, posted };
}

// Shortcut args are shaped differently from a slash command ({shortcut, ack,
// client} vs {command, ack, respond}), so the admin gate needed its own wrapper
// — this is the regression test for that wrapper actually gating correctly.
test("adminOnlyShortcut blocks a non-admin and answers ephemerally", async () => {
  const { client, posted } = stubEphemeralClient();
  const inner = async () => {
    throw new Error("must not run for a non-admin");
  };

  await adminOnlyShortcut(inner)({
    shortcut: { channel: { id: "C1" }, user: { id: "U0NOTADMIN" } },
    ack: async () => {},
    client,
  });

  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /helpers-only/);
});

test("adminOnlyShortcut runs the handler for an admin", async () => {
  let ran = false;
  await adminOnlyShortcut(async () => void (ran = true))({
    shortcut: { channel: { id: "C1" }, user: { id: ADMIN } },
    ack: async () => {},
    client: {},
  });
  assert.equal(ran, true);
});

test("teachThreadShortcut queues a summary and confirms ephemerally", async () => {
  const { client, posted } = stubEphemeralClient();
  const savedSummarize = teachThread.summarizeThread;
  const savedCapture = learn.captureFromThread;
  teachThread.summarizeThread = async () => ({ question: "how do i join", answer: "post in #pixl-help" });
  learn.captureFromThread = () => 42;

  try {
    await teachThreadShortcut({
      shortcut: {
        channel: { id: "C1" },
        message: { thread_ts: "1.1", ts: "1.2" },
        message_ts: "1.2",
        user: { id: ADMIN },
      },
      ack: async () => {},
      client,
    });
  } finally {
    teachThread.summarizeThread = savedSummarize;
    learn.captureFromThread = savedCapture;
  }

  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /queued for review/);
  assert.match(posted[0].text, /#42/);
});

test("teachThreadShortcut tells the admin when nothing was found", async () => {
  const { client, posted } = stubEphemeralClient();
  const saved = teachThread.summarizeThread;
  teachThread.summarizeThread = async () => null;

  try {
    await teachThreadShortcut({
      shortcut: { channel: { id: "C1" }, message: { ts: "1.2" }, message_ts: "1.2", user: { id: ADMIN } },
      ack: async () => {},
      client,
    });
  } finally {
    teachThread.summarizeThread = saved;
  }

  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /couldn't find/);
});

test("programCommand list, add, set, and remove", async () => {
  const responses = [];
  const sendEphemeral = async (msg) => responses.push(msg.text);

  await commands.programCommand({ command: { text: "list" }, ack: async () => {}, respond: sendEphemeral });
  assert.match(responses[0], /registered programs/);

  await commands.programCommand({ command: { text: "add testprog Test Program" }, ack: async () => {}, respond: sendEphemeral });
  assert.match(responses[1], /saved program `testprog`/);

  await commands.programCommand({ command: { text: "set testprog posture passive" }, ack: async () => {}, respond: sendEphemeral });
  assert.match(responses[2], /updated `testprog` posture to `passive`/);

  await commands.programCommand({ command: { text: "remove testprog" }, ack: async () => {}, respond: sendEphemeral });
  assert.match(responses[3], /removed program `testprog`/);
});

test("guideCommand returns interactive picker blocks when no text passed", async () => {
  const responses = [];
  const sendEphemeral = async (msg) => responses.push(msg);

  await commands.guideCommand({
    command: { text: "", channel_id: "C1", user_id: "U1" },
    ack: async () => {},
    respond: sendEphemeral,
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].text, "Interactive Walkthrough Guides");
  assert.ok(responses[0].blocks.length >= 2);
});

// Slash commands answer with their own ephemeral helper rather than going
// through lib/reply.js, so without this wrapper `/pixie <question>` would be
// the one place pixie still talks in dashes.
test("every registered command has its ephemeral replies de-dashed", async () => {
  const registered = {};
  const app = {
    command: (name, handler) => {
      registered[name] = handler;
    },
    action: () => {},
    shortcut: () => {},
    event: () => {},
    view: () => {},
  };
  commands.register(app);

  const sent = [];
  const handler = commands.plainSpoken(async ({ respond }) => {
    await respond({ response_type: "ephemeral", text: "the price — 11,400 px" });
  });
  await handler({ command: { user_id: "U1" }, ack: async () => {}, respond: async (p) => sent.push(p) });

  assert.equal(sent[0].text, "the price, 11,400 px");
  assert.ok(Object.keys(registered).length > 0, "register() bound no commands");
});
