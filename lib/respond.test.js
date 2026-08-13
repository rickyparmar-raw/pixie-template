process.env.PIXIE_DB_PATH = ":memory:";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const answer = require("./answer");
const llm = require("./llm");
const respond = require("./respond");
const cache = require("./cache");
const intent = require("./intent");
const link = require("./link");
const lookup = require("./lookup");
const { config } = require("./config");

db.open(":memory:");

// respond() drives the model. Without this it makes a real call to the model API
// per assertion, which made the test slow, network-dependent, and non-hermetic —
// it timed out at node:test's 5s default whenever the API was having a slow
// minute, and a timed-out test also swallows the *next* file's tests under Bun's
// node:test shim ("test() inside another test() is not yet implemented").
// Returning null is the "docs didn't cover it" answer, which is the branch every
// assertion below is about.
answer.getGroundedAnswer = async () => null;
answer.getAnswerOrChat = async () => null;
// respond() also runs guide detection first, which falls back to a model call
// when its keyword pass misses. NONE keeps these tests on the answer path.
//
// llm is a shared, cached module — every test file `require("./llm")`s the
// same exports object. Stubbing at require time (module top level) poisons it
// during Bun's collection phase, before any file's tests have run at all, so
// before()/after() bracket the stub around this file's own execution window
// instead — anything outside that window sees the real llm.complete.
let realComplete;
before(() => {
  realComplete = llm.complete;
  llm.complete = async () => ({ text: "NONE", finishReason: "stop" });
});
after(() => {
  llm.complete = realComplete;
});

/* -------------------------------------------------- isClarifyingQuestion -- */
// Suppresses the reply that started this: an unaddressed message getting
// "sorry, what about ridit? could you clarify what you mean?" back.

test("isClarifyingQuestion catches a short question handed back to the user", () => {
  assert.equal(respond.isClarifyingQuestion("sorry, what about ridit? could you clarify what you mean?"), true);
  assert.equal(respond.isClarifyingQuestion("hmm what do you mean?"), true);
});

test("isClarifyingQuestion ignores replies that are not questions", () => {
  assert.equal(respond.isClarifyingQuestion("yeah just export it as a PNG at native size"), false);
  assert.equal(respond.isClarifyingQuestion(""), false);
  assert.equal(respond.isClarifyingQuestion(undefined), false);
});

// A real answer may still end in a question. Only the short ones — the ones
// that are nothing but the question — count as handing the work back.
test("isClarifyingQuestion ignores a real answer that ends in a question", () => {
  assert.equal(
    respond.isClarifyingQuestion(
      "check your canvas size is small, 32x32 or 16x16, and that you're exporting as PNG at native size" +
        " without scaling it up. the file extension matters too, so make sure that's right. does that sort it?",
    ),
    false,
  );
});

test("gap recording is gated on looksLikeHelpRequest", async () => {
  let escalateAdded = false;
  const mockClient = {
    chat: {
      postMessage: async () => ({ ts: "msg-1" }),
      update: async () => ({}),
      delete: async () => ({}),
    },
    reactions: {
      add: async () => {
        escalateAdded = true;
      },
    },
  };

  // The question asked of this test isn't "does this gap appear in the ranked
  // list" (which has its own asker-count floor now) — it's "did the bot
  // record the miss at all". Look directly at doc_gaps to avoid coupling the
  // recording test to ranking changes.
  const initialGaps = db.handle().query("SELECT COUNT(*) AS c FROM doc_gaps").get().c;

  // "thanks guys" is small talk -> should NOT record gap
  await respond.respond({
    client: mockClient,
    channel: "C-help",
    threadTs: "t-1",
    userId: "U1",
    question: "thanks guys",
    mode: respond.DOCS_ONLY,
  });

  assert.equal(db.handle().query("SELECT COUNT(*) AS c FROM doc_gaps").get().c, initialGaps);
  assert.equal(escalateAdded, false);

  // Help request miss in DOCS_ONLY -> SHOULD record gap
  await respond.respond({
    client: mockClient,
    channel: "C-help",
    threadTs: "t-2",
    userId: "U2",
    question: "my sprite wont load at all, what should i do?",
    mode: respond.DOCS_ONLY,
  });

  const after = db.handle().query("SELECT question FROM doc_gaps").all();
  assert.equal(after.length, initialGaps + 1);
  assert.ok(after.some((g) => g.question === "my sprite wont load at all, what should i do?"));
});

test("respond refuses blocked local URLs with a friendly explanation", async () => {
  let postedText = "";
  const mockClient = {
    chat: {
      postMessage: async ({ text }) => {
        postedText = text;
        return { ts: "msg-blocked" };
      },
    },
  };

  const handled = await respond.respond({
    client: mockClient,
    channel: "C1",
    threadTs: "t-blocked",
    userId: "U1",
    question: "pixie how does this website look to u? http://localhost:8000",
    mode: respond.ALWAYS,
  });

  assert.equal(handled, true);
  assert.match(postedText, /localhost on your machine isn't reachable from the bot/);
});

/* ------------------------------------------------------ streaming + cache -- */

function fakeClient() {
  const calls = { posts: [], updates: [], deletes: 0 };
  return {
    calls,
    chat: {
      postMessage: async ({ text }) => {
        calls.posts.push(text);
        return { ts: `msg-${calls.posts.length}` };
      },
      update: async ({ text }) => {
        calls.updates.push(text);
        return {};
      },
      delete: async () => {
        calls.deletes += 1;
        return {};
      },
    },
    reactions: { add: async () => ({}) },
  };
}

// Drives respond() with a stubbed streaming answer, restoring the stub after.
async function withStreamedAnswer(chunks, fn) {
  const original = answer.getAnswerOrChatStream;
  answer.getAnswerOrChatStream = async (_q, _corpus, _ctx, { onText } = {}) => {
    let seen = "";
    for (const chunk of chunks) {
      seen += chunk;
      if (onText) onText(seen);
    }
    return { source: "Pixl FAQ", answer: seen };
  };
  try {
    return await fn();
  } finally {
    answer.getAnswerOrChatStream = original;
  }
}

test("respond streams the answer into the placeholder instead of waiting for all of it", async () => {
  const client = fakeClient();

  await withStreamedAnswer(["the deadline", " the deadline is august 18"], () =>
    respond.respond({
      client,
      channel: "C1",
      threadTs: "t-stream",
      userId: "U-stream",
      question: "when is the deadline",
      mode: respond.ALWAYS,
    }),
  );

  // One placeholder posted, then edited in place — never a second message.
  assert.equal(client.calls.posts.length, 1);
  assert.equal(client.calls.posts[0], "_thinking..._");
  assert.ok(client.calls.updates.length >= 1, "expected at least one streamed update");
  assert.match(client.calls.updates[client.calls.updates.length - 1], /august 18/);
});

// The bug this whole path existed to fix: respond() used to add the question to
// the thread transcript *before* reading it back, so contextPrompt was never
// empty and the cache could never be written or read on any threaded path.
test("a fresh question is cacheable, and the repeat costs no model call", async () => {
  const client = fakeClient();
  const question = "how do i export a sprite";

  let modelCalls = 0;
  const original = answer.getAnswerOrChatStream;
  answer.getAnswerOrChatStream = async () => {
    modelCalls += 1;
    return { source: "Pixl FAQ", answer: "export it as a PNG at native size" };
  };

  try {
    await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-cache-a",
      userId: "U-cache",
      question,
      mode: respond.ALWAYS,
    });
    assert.equal(modelCalls, 1);
    assert.notEqual(cache.get(question), null, "the answer should have been cached");

    // Same question, different thread, different person, reworded.
    await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-cache-b",
      userId: "U-other",
      question: "  sprite   EXPORT?? ",
      mode: respond.ALWAYS,
    });
    assert.equal(modelCalls, 1, "the repeat should have been served from cache");
  } finally {
    answer.getAnswerOrChatStream = original;
  }
});

/* ------------------------------------------------- help-channel awareness -- */

// respond() knows the channel it's posting to — it must tell the model
// whether that channel IS #pixl-help, so an ungrounded miss doesn't tell
// someone already reading #pixl-help to go ask in #pixl-help.
test("respond tells the model when the channel it's replying in is the help channel", async () => {
  const savedHelpChannel = config.slack.helpChannel;
  config.slack.helpChannel = "C0HELP";

  const seen = [];
  const original = answer.getAnswerOrChatStream;
  answer.getAnswerOrChatStream = async (_q, _corpus, _ctx, opts = {}) => {
    seen.push(opts.inHelpChannel);
    return { source: null, answer: "not sure on that one" };
  };

  try {
    await respond.respond({
      client: fakeClient(),
      channel: "C0HELP",
      threadTs: "t-help-aware",
      userId: "U-help",
      question: "is it launched yet",
      mode: respond.ALWAYS,
    });
    await respond.respond({
      client: fakeClient(),
      channel: "C0OTHER",
      threadTs: "t-help-unaware",
      userId: "U-other",
      question: "is it launched yet also",
      mode: respond.ALWAYS,
    });
  } finally {
    answer.getAnswerOrChatStream = original;
    config.slack.helpChannel = savedHelpChannel;
  }

  assert.deepEqual(seen, [true, false]);
});

// A genuine follow-up depends on what was said above, so it must NOT be served
// a cached answer shaped by someone else's conversation.
test("a follow-up in a live thread still bypasses the cache", async () => {
  const client = fakeClient();
  let modelCalls = 0;
  const original = answer.getAnswerOrChatStream;
  answer.getAnswerOrChatStream = async () => {
    modelCalls += 1;
    return { source: "Pixl FAQ", answer: "check your canvas size" };
  };

  try {
    const ask = (question) =>
      respond.respond({ client, channel: "C1", threadTs: "t-followup", userId: "U-f", question, mode: respond.ALWAYS });

    await ask("why is my tileset blurry");
    await ask("why is my tileset blurry");
    assert.equal(modelCalls, 2, "the second message has thread context, so it is not a cache hit");
  } finally {
    answer.getAnswerOrChatStream = original;
  }
});

// The intent gate now runs alongside the answer instead of in front of it, so
// the answer can be mid-stream when the verdict lands. Nothing may have reached
// Slack: the old serial path never started the answer at all, and posting then
// deleting a placeholder is worse noise than the delay it hides.
test("a message the gate rejects never reaches Slack, even mid-stream", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  // Answer streams first, verdict lands after — the race the old code never ran.
  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("well actually, the thing about rust is");
    await new Promise((r) => setTimeout(r, 5));
    return { source: null, answer: "well actually, the thing about rust is" };
  };
  intent.classifyIntent = async () => intent.CASUAL_CHAT;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-gate",
      userId: "U-gate",
      question: "does anyone know if this is even worth doing",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, false);
    assert.deepEqual(client.calls.posts, [], "no placeholder should have been posted");
    assert.deepEqual(client.calls.updates, [], "no text should have been written");
    assert.equal(client.calls.deletes, 0, "nothing to delete, because nothing was posted");
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

test("a message the gate accepts is answered normally", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("check your canvas size");
    return { source: "Pixl Docs", answer: "check your canvas size" };
  };
  intent.classifyIntent = async () => intent.HELP_NEEDED;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-gate-ok",
      userId: "U-gate-ok",
      question: "my exported sprite comes out blurry, what do i do?",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, true);
    assert.equal(client.calls.posts.length, 1);
    assert.match(client.calls.updates.join(" "), /canvas size/);
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

// classifyIntent returns null when the call itself fails — every provider
// rate-limited at once, not a real "nobody's asking" verdict. That used to fall
// back to a regex over the message. There is no regex any more, and guessing is
// exactly what this change exists to stop, so a verdict pixie could not get is
// a verdict pixie does not act on.
test("a gate that errors stays quiet rather than guessing", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("check your canvas size");
    return { source: "Pixl Docs", answer: "check your canvas size" };
  };
  intent.classifyIntent = async () => null;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-gate-null",
      userId: "U-gate-null",
      question: "how do i connect hackatime",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, false);
    assert.deepEqual(client.calls.posts, [], "no placeholder should have been posted");
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

// Being addressed is not a verdict the gate gets to overturn — ALWAYS never
// calls it at all, so an outage in the classifier cannot silence a DM or a
// direct ping.
test("a gate outage cannot silence someone who addressed pixie directly", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("check your canvas size");
    return { source: "Pixl Docs", answer: "check your canvas size" };
  };
  intent.classifyIntent = async () => {
    throw new Error("every provider is rate limited");
  };

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-gate-always",
      userId: "U-gate-always",
      question: "where does the hackatime token go",
      mode: respond.ALWAYS,
    });

    assert.equal(replied, true);
    assert.match(client.calls.updates.join(" "), /canvas size/);
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

// The gate is given the person's own recent messages, not just the message it
// is judging — that is the whole point of the change. Without them "still
// nothing" is unreadable.
test("the gate is handed the asker and channel so it can read their recent messages", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  let seen = null;
  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("check the log");
    return { source: "Pixl Docs", answer: "check the log" };
  };
  intent.classifyIntent = async (_msg, _prog, opts) => {
    seen = opts;
    return intent.HELP_NEEDED;
  };

  try {
    await respond.respond({
      client,
      channel: "C-ctx",
      threadTs: "t-gate-ctx",
      userId: "U-ctx",
      question: "still nothing",
      mode: respond.HELP_ONLY,
    });
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }

  assert.equal(seen?.userId, "U-ctx");
  assert.equal(seen?.channel, "C-ctx");
});

// A program scoped to its own questions gets a third verdict. It is not a gap
// in the docs — nothing was missing, the question just wasn't pixie's to take —
// so it is counted apart from the ordinary "nobody was asking" silence.
test("an OFF_TOPIC verdict stays quiet and is not filed as a docs gap", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;
  const before = db.topGaps(50).length;

  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("flexbox has a few ways to do that");
    return { source: null, answer: "flexbox has a few ways to do that" };
  };
  intent.classifyIntent = async () => intent.OFF_TOPIC;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-offtopic",
      userId: "U-offtopic",
      question: "how do i center a div in css",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, false);
    assert.deepEqual(client.calls.posts, [], "nothing should have been posted");
    assert.equal(db.topGaps(50).length, before, "an off-topic question is not a hole in the docs");
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

// The whole point of the escape hatch: scope decides what pixie volunteers,
// never what she refuses when asked.
test("addressed is passed to the gate so a direct ask escapes the scope", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  let seen = null;
  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText("use flexbox");
    return { source: "Pixl Docs", answer: "use flexbox" };
  };
  intent.classifyIntent = async (_msg, _prog, opts) => {
    seen = opts;
    return intent.HELP_NEEDED;
  };

  try {
    await respond.respond({
      client,
      channel: "C-scope",
      threadTs: "t-addressed",
      userId: "U-addressed",
      question: "pixie how do i center a div",
      mode: respond.HELP_ONLY,
      addressed: true,
    });
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }

  assert.equal(seen?.addressed, true);
});

// The program record and the channel both have to reach the answer call, or the
// prompt can't say where it is. Passing the bare id was the old bug: the model
// was told it served "the pixl program", lowercase, because that is the
// database key rather than the name.
test("the answer call is handed the program record and the channel it is in", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  let seen = null;
  answer.getAnswerOrChatStream = async (_q, _c, _ctx, opts = {}) => {
    seen = opts;
    if (opts.onText) opts.onText("check the docs");
    return { source: "Pixl Docs", answer: "check the docs" };
  };
  intent.classifyIntent = async () => intent.HELP_NEEDED;

  try {
    await respond.respond({
      client,
      channel: "C-where",
      threadTs: "t-where",
      userId: "U-where",
      question: "how do i wire up the tileset exporter",
      mode: respond.HELP_ONLY,
    });
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }

  assert.equal(seen?.channel, "C-where");
  assert.equal(typeof seen?.program, "object", "a program record, not an id string");
  assert.ok(seen?.program?.name, "with a display name the prompt can use");
});

/* ------------------------------------------------------ the instant path -- */

// A known answer used to cost two Slack round trips — placeholder, then edit —
// because the cache was only consulted inside answerOrChat, after the
// "_thinking..._" message had already gone out. ~800ms to say something pixie
// worked out in about a millisecond.
test("a known answer is one Slack call, with no placeholder", async () => {
  const client = fakeClient();
  const original = answer.getAnswerOrChatStream;
  let modelCalls = 0;
  answer.getAnswerOrChatStream = async () => {
    modelCalls += 1;
    return { source: "Pixl FAQ", answer: "anyone can join, no team needed" };
  };

  try {
    const ask = (threadTs, question) =>
      respond.respond({ client, channel: "C1", threadTs, userId: `U-${threadTs}`, question, mode: respond.ALWAYS });

    await ask("t-instant-a", "who can join pixl");
    assert.equal(modelCalls, 1);
    const afterFirst = { posts: client.calls.posts.length, updates: client.calls.updates.length };

    await ask("t-instant-b", "who can join pixl?");
    assert.equal(modelCalls, 1, "the second ask must not reach the model");
    assert.equal(client.calls.posts.length, afterFirst.posts + 1, "exactly one new message");
    assert.equal(client.calls.updates.length, afterFirst.updates, "and no edit of it afterwards");
    assert.equal(client.calls.posts.at(-1), "anyone can join, no team needed");
  } finally {
    answer.getAnswerOrChatStream = original;
  }
});

// Being fast is not a reason to speak when nobody asked — a cached answer has
// to clear the same gate a fresh one would.
test("the instant path still respects the gate", async () => {
  const client = fakeClient();
  const originalIntent = intent.classifyIntent;
  intent.classifyIntent = async () => intent.CASUAL_CHAT;

  try {
    cache.put("how do i export a tileset", { source: "Pixl Docs", answer: "export at native size" });

    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-instant-gate",
      userId: "U-ig",
      question: "how do i export a tileset",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, false);
    assert.deepEqual(client.calls.posts, []);
  } finally {
    intent.classifyIntent = originalIntent;
  }
});

// A pasted link has to be read before pixie says anything about it. The page
// content joins the prompt after the cache probe, so answering from cache here
// would reply to the question and ignore the link entirely.
test("a message with a link never takes the instant path", async () => {
  const client = fakeClient();
  const original = answer.getAnswerOrChatStream;
  let modelCalls = 0;
  answer.getAnswerOrChatStream = async () => {
    modelCalls += 1;
    return { source: "Pixl Docs", answer: "looks fine" };
  };

  // Stubbed so the suite stays hermetic — this test is about which path
  // respond() takes, not about fetching a real page.
  const originalFetch = link.fetchUrlContent;
  link.fetchUrlContent = async () => ({ text: "a page", blocked: false });

  try {
    cache.put("how does this look", { source: "Pixl Docs", answer: "cached opinion" });
    await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-link",
      userId: "U-link",
      question: "how does this look https://pixl.rsvp",
      mode: respond.ALWAYS,
    });
    assert.equal(modelCalls, 1, "the link must be read, not answered from cache");
  } finally {
    answer.getAnswerOrChatStream = original;
    link.fetchUrlContent = originalFetch;
  }
});

/* --------------------------------------------------------- guide steps -- */
// A :upvote: reaction is now an alternative to typing "yes" (see
// onReactionAdded in lib/handlers.js), so the old "(yes/no)" wording is
// misleading on its own — formatGuideText drops it. The "here's how to
// react" explanation itself lives in a Block Kit context element
// (guides.buildGuideBlocks), not in this plain-text fallback, and only shows
// on a guide's first step — repeating it in the text of every single step
// read as spam.

test("formatGuideText leaves a step with no checkNext untouched", () => {
  assert.equal(respond.formatGuideText({ message: "all done!" }), "all done!");
});

test("formatGuideText strips the old yes/no suffix and never mentions the reaction hint", () => {
  const text = respond.formatGuideText({ message: "open the shop tab", checkNext: "see it? (yes/no)" });

  assert.ok(!text.includes("(yes/no)"));
  assert.ok(text.includes("see it?"));
  assert.ok(!text.includes(":upvote:"));
});

test("formatGuideText keeps an open-ended checkNext question intact", () => {
  const text = respond.formatGuideText({
    message: "check your RE",
    checkNext: "how much RE do you have rn?",
  });

  assert.ok(text.includes("how much RE do you have rn?"));
});

test("postGuideStep records the posted message's ts so a reaction can find it later", async () => {
  const guides = require("./guides");
  guides.startGuide("submit-ysws-guidelines", "thread-post-step", "U1");

  const client = fakeClient();
  const ts = await respond.postGuideStep({
    client,
    channel: "C1",
    threadTs: "thread-post-step",
    result: { message: "step one", checkNext: "done? (yes/no)" },
  });

  assert.equal(ts, "msg-1");
  assert.equal(db.getGuideByMessageTs("msg-1").thread_ts, "thread-post-step");
});

test("postGuideStep shows the reaction hint only on a guide's first step", async () => {
  let lastBlocks = null;
  const client = { chat: { postMessage: async ({ blocks }) => { lastBlocks = blocks; return { ts: "msg-hint-1" }; } } };

  await respond.postGuideStep({
    client,
    channel: "C1",
    threadTs: "thread-hint-first",
    result: { message: "step one", checkNext: "ready? (yes/no)" },
    isFirstStep: true,
  });
  assert.ok(lastBlocks.some((b) => b.type === "context"));

  await respond.postGuideStep({
    client,
    channel: "C1",
    threadTs: "thread-hint-later",
    result: { message: "step two", checkNext: "ready? (yes/no)" },
  });
  assert.ok(!lastBlocks.some((b) => b.type === "context"));
});

test("postGuideStep does not record a message_ts for a completed or cancelled guide", async () => {
  const guides = require("./guides");
  // Guide row still exists at post time (continueGuide/advanceGuideByReaction
  // delete it as part of returning the completed/cancelled result, so this
  // simulates the row NOT having been cleared yet) — if postGuideStep skipped
  // the completed/cancelled check, this write would succeed and the
  // assertion below would catch it.
  guides.startGuide("submit-ysws-guidelines", "thread-post-done", "U1");

  const client = { chat: { postMessage: async () => ({ ts: "msg-completed-1" }) } };
  await respond.postGuideStep({
    client,
    channel: "C1",
    threadTs: "thread-post-done",
    result: { message: "all set!", completed: true },
  });

  assert.equal(db.getGuideByMessageTs("msg-completed-1"), null);
});

/* ------------------------------------------------ handing the work back -- */
// The reply that prompted this: someone posted "eh how do i do tthis ?" in a
// program channel and got back
//
//   "do what? if you're asking about something pixl-specific like submitting,
//    setting up hackatime, git, or starting a project, just tell me what part
//    you're stuck on and i can walk you through it :hii:"
//
// which is pixie saying, at length, that it has no idea what was asked. The
// guard for this already existed — it just only recognised a hand-back that was
// nothing but a short question, and this one opens with the question and then
// keeps talking, so it sailed straight through.

test("isClarifyingQuestion catches a hand-back that carries on past the question", () => {
  assert.equal(
    respond.isClarifyingQuestion(
      "do what? if you're asking about something pixl-specific like submitting, setting up hackatime," +
        " git, or starting a project, just tell me what part you're stuck on and i can walk you through it :hii:",
    ),
    true,
  );
  assert.equal(
    respond.isClarifyingQuestion("not sure what you're referring to there — drop a bit more context and i can help :hii:"),
    true,
  );
  assert.equal(
    respond.isClarifyingQuestion("hey! could you clarify what you mean, then i'll have a proper go at it"),
    true,
  );
});

// The cost of getting this wrong is a real answer deleted, so the phrases have
// to be ones that only ever appear when pixie is asking what the subject IS —
// not ones that show up in an answer that happens to ask for a detail.
test("isClarifyingQuestion leaves real answers alone", () => {
  assert.equal(
    respond.isClarifyingQuestion(
      "depends what you're trying to do — if you just want a bigger canvas, set it before you start drawing," +
        " since resizing later rescales everything",
    ),
    false,
  );
  assert.equal(
    respond.isClarifyingQuestion(
      "the export part is under File > Export, and the scale option sits right under it — leave it at 1x",
    ),
    false,
  );
});

// A hand-back is not a documentation gap. Nothing was missing from the docs;
// pixie never worked out what the subject was, so writing the message to the
// "what should we document" list just fills it with unanswerable noise.
test("an unaddressed hand-back is deleted and not recorded as a docs gap", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  const handBack =
    "do what? if you're asking about something pixl-specific like submitting, setting up hackatime," +
    " git, or starting a project, just tell me what part you're stuck on and i can walk you through it :hii:";

  answer.getAnswerOrChatStream = async (_q, _c, _ctx, { onText } = {}) => {
    if (onText) onText(handBack);
    return { source: null, answer: handBack };
  };
  intent.classifyIntent = async () => intent.HELP_NEEDED;

  const gapsBefore = db.topGaps(200).length;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-handback",
      userId: "U-handback",
      question: "eh how do i do tthis ?",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, false);
    assert.equal(db.topGaps(200).length, gapsBefore, "a hand-back is not a docs gap");
    assert.ok(client.calls.deletes >= 1, "the streamed placeholder should have been deleted");
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

// The regex above is the backstop for a model that writes the paragraph anyway.
// The primary path is the model saying, in one token, that the message gave it
// nothing to answer — which has to end in silence and not in the "ask a helper"
// fallback, or the noise is the same noise with different words.
test("an unclear verdict is silence, not the mention fallback", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;
  const originalIntent = intent.classifyIntent;

  answer.getAnswerOrChatStream = async () => ({ source: null, answer: "", unclear: true });
  intent.classifyIntent = async () => intent.HELP_NEEDED;

  const gapsBefore = db.topGaps(200).length;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-unclear",
      userId: "U-unclear",
      question: "eh how do i do tthis ?",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, false);
    assert.deepEqual(
      client.calls.posts.filter((t) => t !== "_thinking..._"),
      [],
      "nothing should have been posted",
    );
    assert.equal(db.topGaps(200).length, gapsBefore, "an unanswerable message is not a docs gap");
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
    intent.classifyIntent = originalIntent;
  }
});

// Somebody typed pixie's name and asked. Silence there reads as broken, so the
// existing "I've got nothing" reply stands — this path is unchanged, and the
// test is here to keep it that way.
test("an unclear verdict still answers someone who addressed pixie directly", async () => {
  const client = fakeClient();
  const originalAnswer = answer.getAnswerOrChatStream;

  answer.getAnswerOrChatStream = async () => ({ source: null, answer: "", unclear: true });

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-unclear-addressed",
      userId: "U-unclear-addressed",
      question: "pixie how do i do this",
      mode: respond.ALWAYS,
    });

    assert.equal(replied, true);
    assert.match(client.calls.posts.concat(client.calls.updates).join(" "), /not totally sure/);
  } finally {
    answer.getAnswerOrChatStream = originalAnswer;
  }
});

test("typing pixie-guide or !guide returns the interactive guide menu in thread", async () => {
  const client = fakeClient();

  const replied1 = await respond.respond({
    client,
    channel: "C1",
    threadTs: "t-guide-menu-1",
    userId: "U-guide-menu-1",
    question: "pixie-guide",
    mode: respond.ALWAYS,
  });

  assert.equal(replied1, true);
  assert.match(client.calls.posts[0], /Interactive Walkthrough Guides/);

  const replied2 = await respond.respond({
    client,
    channel: "C1",
    threadTs: "t-guide-menu-2",
    userId: "U-guide-menu-2",
    question: "!guide",
    mode: respond.ALWAYS,
  });

  assert.equal(replied2, true);
  assert.match(client.calls.posts[1], /Interactive Walkthrough Guides/);
});

test("stfu pixie mutes the thread and leaves", async () => {
  const client = fakeClient();
  const threadTs = "t-stfu-test";

  db.saveGuide(threadTs, "midi-controller", 0, "U1");
  assert.ok(db.getGuide(threadTs));

  const replied = await respond.respond({
    client,
    channel: "C1",
    threadTs,
    userId: "U1",
    question: "stfu pixie",
    mode: respond.ALWAYS,
  });

  assert.equal(replied, true);
  assert.equal(db.getGuide(threadTs), null, "active guide was cancelled");
  assert.equal(db.isThreadMuted(threadTs), true, "thread is marked as muted");
  assert.match(client.calls.posts.join(" "), /leaving the thread/);
});

// The shop maths is worked out in code, and it only ever fires on a message
// that named a priced item or answered pixie's own question about a tier. The
// gate's job is deciding whether anybody is asking for help, and by the time
// one of these comes back it has already been established that they were — so
// letting the gate bin it drops a correct, cited answer for no reason.
test("a deterministic shop answer is not thrown away by the intent gate", async () => {
  const client = fakeClient();
  const originalLookup = lookup.answerOrChat;
  const originalIntent = intent.classifyIntent;

  lookup.answerOrChat = async () => ({
    source: "Pixl Shop",
    direct: true,
    answer: "PS5 Digital, 825gb +wireless controller is 11,400 px.",
  });
  intent.classifyIntent = async () => intent.CASUAL_CHAT;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-shop",
      userId: "U-shop",
      question: "how much hours needed for t4 for ps5",
      mode: respond.HELP_ONLY,
    });

    assert.equal(replied, true);
    const said = [...client.calls.posts, ...client.calls.updates].join(" ");
    assert.match(said, /11,400/);
  } finally {
    lookup.answerOrChat = originalLookup;
    intent.classifyIntent = originalIntent;
  }
});

test("an ordinary ungrounded answer is still thrown away by the gate", async () => {
  const client = fakeClient();
  const originalLookup = lookup.answerOrChat;
  const originalIntent = intent.classifyIntent;

  lookup.answerOrChat = async () => ({ source: null, answer: "yeah man totally" });
  intent.classifyIntent = async () => intent.CASUAL_CHAT;

  try {
    const replied = await respond.respond({
      client,
      channel: "C1",
      threadTs: "t-shop-2",
      userId: "U-shop",
      question: "lol",
      mode: respond.HELP_ONLY,
    });
    assert.equal(replied, false);
  } finally {
    lookup.answerOrChat = originalLookup;
    intent.classifyIntent = originalIntent;
  }
});

/* ------------------------------------------------ brand-aware text matching -- */
// Two plain-text triggers used to be hardcoded to the word "pixie": asking for
// the guide menu, and telling the bot to be quiet. On a rebranded bot both are
// typed with its own name, so the literals would simply never fire — the mute
// request in particular is the one people reach for when the bot is being
// annoying, and it silently doing nothing is the worst version of that.

function withBrand(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the guide menu answers to the bot's own name", () => {
  withBrand({ PIXIE_BOT_NAME: "Sol", PIXIE_BOT_SLUG: "sol" }, () => {
    assert.equal(respond.isGuideMenuRequest("sol guides"), true);
    assert.equal(respond.isGuideMenuRequest("sol-guide"), true);
    assert.equal(respond.isGuideMenuRequest("/sol-guide"), true);
    // Unprefixed and pixie's own forms keep working either way.
    assert.equal(respond.isGuideMenuRequest("!guides"), true);
    assert.equal(respond.isGuideMenuRequest("/guide"), true);
  });
});

test("a mute request works by the bot's own name", () => {
  withBrand({ PIXIE_BOT_NAME: "Sol", PIXIE_BOT_SLUG: "sol" }, () => {
    assert.equal(respond.isMuteRequest("stfu sol"), true);
    assert.equal(respond.isMuteRequest("sol shut up"), true);
    assert.equal(respond.isMuteRequest("sol stfu"), true);
    assert.equal(respond.isMuteRequest("quiet sol"), true);
    // Same shape as the original matcher: the shush word has to lead, so a
    // mid-sentence "be quiet sol please" is not a mute. Left as-is deliberately —
    // widening it here would change what pixie itself does.
    assert.equal(respond.isMuteRequest("be quiet sol please"), false);
  });
});

test("an unrelated message is still not a mute request", () => {
  withBrand({ PIXIE_BOT_NAME: "Sol", PIXIE_BOT_SLUG: "sol" }, () => {
    assert.equal(respond.isMuteRequest("how do i submit my project"), false);
    assert.equal(respond.isMuteRequest("sol how do i start"), false);
    assert.equal(respond.isGuideMenuRequest("sol what guides are there"), false);
  });
});

// The default deployment must behave exactly as before.
test("with no brand set, the pixie forms still match", () => {
  withBrand({ PIXIE_BOT_NAME: undefined, PIXIE_BOT_SLUG: undefined }, () => {
    assert.equal(respond.isGuideMenuRequest("pixie guides"), true);
    assert.equal(respond.isGuideMenuRequest("/pixie-guide"), true);
    assert.equal(respond.isMuteRequest("stfu pixie"), true);
    assert.equal(respond.isMuteRequest("pixie stfu"), true);
  });
});

// A slug with regex metacharacters must not blow up the matcher — it's
// interpolated into a RegExp, so it has to be escaped.
test("a slug containing regex metacharacters is escaped, not executed", () => {
  withBrand({ PIXIE_BOT_NAME: "c++ bot", PIXIE_BOT_SLUG: undefined }, () => {
    assert.doesNotThrow(() => respond.isMuteRequest("stfu c++ bot"));
    assert.equal(respond.isGuideMenuRequest("nonsense"), false);
  });
});
