process.env.PIXIE_DB_PATH = ":memory:";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const { config } = require("./config");
const handlers = require("./handlers");
const context = require("./context");
const respond = require("./respond");
const learn = require("./learn");
const vision = require("./vision");

db.open(":memory:");
config.slack.botUserId = "U0PIXIE";

test("mentionsPixieByName matches the name and its suffixes", () => {
  assert.equal(handlers.mentionsPixieByName("pixie help"), true);
  assert.equal(handlers.mentionsPixieByName("hey Pixie!"), true);
  assert.equal(handlers.mentionsPixieByName("pixies are cool"), true);
});

test("mentionsPixieByName ignores unrelated text", () => {
  assert.equal(handlers.mentionsPixieByName("pixl is great"), false);
  assert.equal(handlers.mentionsPixieByName(""), false);
  assert.equal(handlers.mentionsPixieByName(undefined), false);
});

test("mentionsPixieByName follows the configured bot identity", () => {
  const savedName = process.env.PIXIE_BOT_NAME;
  const savedSlug = process.env.PIXIE_BOT_SLUG;
  process.env.PIXIE_BOT_NAME = "Live Helper";
  process.env.PIXIE_BOT_SLUG = "live-helper";
  try {
    assert.equal(handlers.mentionsPixieByName("live helper can you help?"), true);
    assert.equal(handlers.mentionsPixieByName("pixie can you help?"), false);
  } finally {
    if (savedName === undefined) delete process.env.PIXIE_BOT_NAME;
    else process.env.PIXIE_BOT_NAME = savedName;
    if (savedSlug === undefined) delete process.env.PIXIE_BOT_SLUG;
    else process.env.PIXIE_BOT_SLUG = savedSlug;
  }
});

// This used to build `<@undefined>` because the bot user ID was read off the
// wrong object, so a real @-mention never matched.
test("mentionsPixieDirectly matches the resolved bot user id", () => {
  assert.equal(handlers.mentionsPixieDirectly("<@U0PIXIE> whats up"), true);
  assert.equal(handlers.mentionsPixieDirectly("<@U0SOMEONE> whats up"), false);
});

test("mentionsPixieDirectly is false when the bot id is unresolved", () => {
  const saved = config.slack.botUserId;
  config.slack.botUserId = null;
  try {
    assert.equal(handlers.mentionsPixieDirectly("<@undefined> hi"), false);
  } finally {
    config.slack.botUserId = saved;
  }
});

test("stripBotMention removes every ping and trims", () => {
  assert.equal(handlers.stripBotMention("<@U0PIXIE> how do i join <@U0PIXIE>"), "how do i join");
});

// Another human being @-mentioned must not suppress the answer — the old
// blanket `<@U` check dropped those messages entirely.
test("stripBotMention leaves other people's mentions intact", () => {
  assert.equal(handlers.stripBotMention("<@U0PIXIE> ask <@U0ALEX> about it"), "ask <@U0ALEX> about it");
});

test("shouldConsiderThreadReply allows all top-level messages", () => {
  assert.equal(handlers.shouldConsiderThreadReply({ ts: "1.1", text: "hi" }), true);
  assert.equal(handlers.shouldConsiderThreadReply({ ts: "1.1", thread_ts: "1.1", text: "hi" }), true);
});

// The expensive case: a thread pixie has nothing to do with should never cost
// an intent call.
test("shouldConsiderThreadReply skips threads pixie has not spoken in", () => {
  assert.equal(
    handlers.shouldConsiderThreadReply({ ts: "2.2", thread_ts: "1.1", text: "lol same" }),
    false,
  );
});

test("shouldConsiderThreadReply allows a thread reply that names or pings pixie", () => {
  assert.equal(handlers.shouldConsiderThreadReply({ ts: "2.2", thread_ts: "1.1", text: "pixie help" }), true);
  assert.equal(
    handlers.shouldConsiderThreadReply({ ts: "2.2", thread_ts: "1.1", text: "<@U0PIXIE> help" }),
    true,
  );
});

test("shouldConsiderThreadReply allows a thread pixie already replied in", () => {
  context.addToThread("thread-spoken", "assistant", "here you go", null, "C1");
  assert.equal(
    handlers.shouldConsiderThreadReply({ ts: "3.3", thread_ts: "thread-spoken", text: "thanks" }),
    true,
  );
});

test("findImage picks the first image with a private URL", () => {
  assert.equal(handlers.findImage({}), null);
  assert.equal(handlers.findImage({ files: [] }), null);
  assert.equal(handlers.findImage({ files: [{ mimetype: "application/pdf", url_private: "u" }] }), null);

  const image = { mimetype: "image/png", url_private: "https://files.slack.com/x.png" };
  assert.equal(handlers.findImage({ files: [{ mimetype: "text/plain" }, image] }), image);
});

/* ----------------------------------------------------- mention with image -- */

// Slack fires both `message` and `app_mention` for "@pixie <screenshot>" and
// both claim the same ts, so whichever arrives first decides the reply. Only
// onMessage looked for an image, so app_mention winning produced "I can't
// actually see images" on a message that plainly had one.
test("onAppMention analyses an attached image instead of replying blind", async () => {
  const savedRespond = respond.respond;
  const savedVision = vision.analyzeImage;
  const posted = [];
  let visionSawQuestion = null;

  respond.respond = async () => {
    throw new Error("an image mention must not fall through to the text path");
  };
  vision.analyzeImage = async (_url, question) => {
    visionSawQuestion = question;
    return "that's a photo of a breadboard";
  };

  try {
    await handlers.onAppMention({
      event: {
        ts: "500.1",
        channel: "C0MENTION",
        user: "U0ASKER",
        text: "<@U0PIXIE> bruda cant u see the IMAGE",
        files: [{ mimetype: "image/png", url_private: "https://files.slack.com/x.png" }],
      },
      client: { chat: { postMessage: async (args) => void posted.push(args) } },
    });
  } finally {
    respond.respond = savedRespond;
    vision.analyzeImage = savedVision;
  }

  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /breadboard/);
  // The raw "<@U0PIXIE>" would otherwise read as part of the question.
  assert.equal(visionSawQuestion, "bruda cant u see the IMAGE");
});

test("onAppMention still uses the text path when there is no image", async () => {
  const savedRespond = respond.respond;
  const calls = [];
  respond.respond = async (args) => void calls.push(args);

  try {
    await handlers.onAppMention({
      event: { ts: "501.1", channel: "C0MENTION", user: "U0ASKER", text: "<@U0PIXIE> how do i ship" },
      client: {},
    });
  } finally {
    respond.respond = savedRespond;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, respond.ALWAYS);
  assert.equal(calls[0].question, "how do i ship");
});

/* -------------------------------------------- help channel thread replies -- */

// Thread replies in the help channel were dropped before any gate ran, so a
// correction to pixie's own answer never reached it — pixie kept the last word
// while being wrong. These cover every way a help-channel message can land.
const HELP_CHANNEL = "C0HELP";

// onMessage reaches the network twice over — respond() answers and
// learn.captureFromReply judges the reply. Both are stubbed so these tests
// assert routing only.
async function routeHelpMessage(event) {
  const savedHelp = config.slack.helpChannel;
  const savedAuto = config.slack.autoReplyChannel;
  const savedRespond = respond.respond;
  const savedCapture = learn.captureFromReply;

  const calls = [];
  config.slack.helpChannel = HELP_CHANNEL;
  config.slack.autoReplyChannel = "C0FAQ";
  respond.respond = async (args) => void calls.push(args);
  learn.captureFromReply = async () => null;

  try {
    await handlers.onMessage({
      event: { channel: HELP_CHANNEL, user: "U0ASKER", ...event },
      client: {},
    });
    return calls;
  } finally {
    config.slack.helpChannel = savedHelp;
    config.slack.autoReplyChannel = savedAuto;
    respond.respond = savedRespond;
    learn.captureFromReply = savedCapture;
  }
}

test("help channel still answers a top-level post", async () => {
  const calls = await routeHelpMessage({ ts: "100.1", text: "how do i submit my project" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, respond.ALWAYS);
  // Nothing to seed from — the post is the whole thread.
  assert.equal(calls[0].seedClient, null);
});

// Pixie answering once is not a licence to keep talking. A thread reply that
// doesn't name or ping her again is left alone — even in a thread she already
// answered in, and even when it reads like a genuine follow-up.
test("help channel ignores a thread reply that doesn't name or ping pixie", async () => {
  context.addToThread("200.1", "assistant", "here's the answer", null, HELP_CHANNEL);
  const calls = await routeHelpMessage({
    ts: "200.2",
    thread_ts: "200.1",
    text: "stfu they do have everything connected, i still can't connect my keyboard",
  });
  assert.equal(calls.length, 0);
});

// Two humans working a problem out are still left alone.
test("help channel ignores a thread reply in a thread pixie never spoke in", async () => {
  const calls = await routeHelpMessage({
    ts: "300.2",
    thread_ts: "300.1",
    text: "did you try reseating the cable?",
  });
  assert.equal(calls.length, 0);
});

// Naming pixie is what brings her back into a thread — whether or not she's
// spoken in it before.
test("help channel answers a thread reply that names pixie", async () => {
  const calls = await routeHelpMessage({
    ts: "400.2",
    thread_ts: "400.1",
    text: "pixie, i still can't connect my keyboard",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, respond.ALWAYS);
  assert.equal(calls[0].threadTs, "400.1");
  // A follow-up only makes sense with the thread above it in context.
  assert.ok(calls[0].seedClient);
});

test("help channel logs a skipped thread reply as not_named", async () => {
  const before = db.metricDetails("silent").find((r) => r.detail === "not_named")?.count || 0;

  const calls = await routeHelpMessage({ ts: "500.2", thread_ts: "500.1", text: "same lol" });

  assert.equal(calls.length, 0);
  const after = db.metricDetails("silent").find((r) => r.detail === "not_named")?.count || 0;
  assert.equal(after, before + 1, "the skip should be attributable in the silence log");
});

/* --------------------------------------------- thread transcript recall --- */

// Pixie used to only remember messages it actually replied to — a thread
// reply it stayed quiet on vanished from context.getThreadContext entirely,
// so a real question later in the same thread had no idea the chatter ever
// happened. These cover the two spots that were silently dropping messages.

test("help channel still records an unnamed thread reply once pixie has spoken there", async () => {
  context.addToThread("700.1", "assistant", "try reinstalling the extension", null, HELP_CHANNEL);

  const calls = await routeHelpMessage({
    ts: "700.2",
    thread_ts: "700.1",
    text: "still not working, tried that already",
  });

  assert.equal(calls.length, 0);
  assert.match(context.getThreadContext("700.1"), /still not working, tried that already/);
});

// The existing "never spoke in" case must stay a true no-op — two humans
// working a problem out in a thread pixie was never part of is not her
// context to keep.
test("help channel does not record an unnamed thread reply in a thread pixie never spoke in", async () => {
  const calls = await routeHelpMessage({
    ts: "800.2",
    thread_ts: "800.1",
    text: "did you try reseating the cable?",
  });

  assert.equal(calls.length, 0);
  assert.equal(context.getThreadContext("800.1"), null);
});

// The regex gate that used to sit here dropped this on the word "lol" and
// never asked anyone. Deciding that from one message was the whole problem —
// "lol thanks so much for that" and "lol so it still wont build" are the same
// shape — so anything with words in it now goes to the classifier, which gets
// to see what this person said just before.
test("faqChannels hands a low-signal reply to the gate instead of dropping it", async () => {
  const FAQ_CHANNEL = "C0FAQTX";
  const savedFaq = config.slack.faqChannels;
  const savedRespond = respond.respond;
  const savedCapture = learn.captureFromReply;

  config.slack.faqChannels = [FAQ_CHANNEL];
  let mode = null;
  respond.respond = async (args) => {
    mode = args.mode;
    return true;
  };
  learn.captureFromReply = async () => null;

  context.addToThread("faq-thread-1", "assistant", "here's how you do it", null, FAQ_CHANNEL);

  try {
    await handlers.onMessage({
      event: {
        ts: "600.2",
        thread_ts: "faq-thread-1",
        channel: FAQ_CHANNEL,
        user: "U0ASKER",
        text: "lol thanks so much for that",
      },
      client: {},
    });
  } finally {
    config.slack.faqChannels = savedFaq;
    respond.respond = savedRespond;
    learn.captureFromReply = savedCapture;
  }

  assert.equal(mode, respond.HELP_ONLY, "the gate decides, not a pattern over the message");
});

// The one thing still decided locally: a message with no words in it is not
// worth a model call. It is recorded so the thread reads correctly, and that
// is all.
test("faqChannels still drops a bare reaction without calling the model", async () => {
  const FAQ_CHANNEL = "C0FAQTY";
  const savedFaq = config.slack.faqChannels;
  const savedRespond = respond.respond;
  const savedCapture = learn.captureFromReply;

  config.slack.faqChannels = [FAQ_CHANNEL];
  respond.respond = async () => {
    throw new Error("should not respond — the message is a bare reaction");
  };
  learn.captureFromReply = async () => null;

  context.addToThread("faq-thread-2", "assistant", "here's how you do it", null, FAQ_CHANNEL);

  try {
    await handlers.onMessage({
      event: {
        ts: "601.2",
        thread_ts: "faq-thread-2",
        channel: FAQ_CHANNEL,
        user: "U0ASKER2",
        text: "lmaooo :yay:",
      },
      client: {},
    });
  } finally {
    config.slack.faqChannels = savedFaq;
    respond.respond = savedRespond;
    learn.captureFromReply = savedCapture;
  }

  assert.match(context.getThreadContext("faq-thread-2"), /lmaooo/);
});

// Every human message is recorded, replied to or not — the gate reads the
// three before the one it is judging, and pixie is silent for most of them.
test("onMessage records what people say even when it stays quiet", async () => {
  const FAQ_CHANNEL = "C0FAQTZ";
  const savedFaq = config.slack.faqChannels;
  const savedRespond = respond.respond;
  const savedCapture = learn.captureFromReply;

  config.slack.faqChannels = [FAQ_CHANNEL];
  respond.respond = async () => true;
  learn.captureFromReply = async () => null;

  try {
    for (const [i, text] of ["my build broke", "tried reinstalling", "still nothing"].entries()) {
      await handlers.onMessage({
        event: { ts: `70${i}.1`, channel: FAQ_CHANNEL, user: "U0DEBUG", text },
        client: {},
      });
    }
  } finally {
    config.slack.faqChannels = savedFaq;
    respond.respond = savedRespond;
    learn.captureFromReply = savedCapture;
  }

  const recent = db.recentUserMessages("U0DEBUG", { channel: FAQ_CHANNEL, limit: 3 });
  assert.deepEqual(
    recent.map((r) => r.text),
    ["my build broke", "tried reinstalling", "still nothing"],
    "oldest first, ready to paste into the gate prompt",
  );
});

/* ------------------------------------------------------- guide reactions -- */

test("onReactionAdded advances a guide when :upvote: lands on its own tracked message", async () => {
  const guides = require("./guides");
  guides.startGuide("submit-ysws-guidelines", "thread-reaction-advance", "U-owner");
  db.setGuideMessageTs("thread-reaction-advance", "700.1");

  const posted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "upvote",
      user: "U-owner",
      item: { type: "message", channel: "C0GUIDE", ts: "700.1" },
      item_user: "U0PIXIE",
    },
    client: { chat: { postMessage: async (args) => { posted.push(args); return { ts: "700.2" }; } } },
  });

  assert.equal(posted.length, 1, "the next step should have been posted");
  assert.equal(db.getGuide("thread-reaction-advance").current_step, 1);
  // The new step's own message is now the one tracked, not the old one.
  assert.equal(db.getGuideByMessageTs("700.2").thread_ts, "thread-reaction-advance");
});

test("onReactionAdded ignores :upvote: from someone other than the guide's owner", async () => {
  const guides = require("./guides");
  guides.startGuide("submit-ysws-guidelines", "thread-reaction-other", "U-owner");
  db.setGuideMessageTs("thread-reaction-other", "701.1");

  const posted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "upvote",
      user: "U-bystander",
      item: { type: "message", channel: "C0GUIDE", ts: "701.1" },
      item_user: "U0PIXIE",
    },
    client: { chat: { postMessage: async (args) => { posted.push(args); return { ts: "701.2" }; } } },
  });

  assert.equal(posted.length, 0, "a bystander's reaction must not advance someone else's guide");
  assert.equal(db.getGuide("thread-reaction-other").current_step, 0);
});

test("onReactionAdded still records ordinary feedback when :upvote: lands on a non-guide message", async () => {
  const savedRecordFeedback = db.recordFeedback;
  const calls = [];
  db.recordFeedback = (...args) => calls.push(args);

  try {
    await handlers.onReactionAdded({
      event: {
        reaction: "upvote",
        user: "U-fan",
        item: { type: "message", channel: "C0DOCS", ts: "702.1" },
        item_user: "U0PIXIE",
      },
      client: {},
    });
  } finally {
    db.recordFeedback = savedRecordFeedback;
  }

  assert.deepEqual(calls, [["702.1", "U-fan", 1]]);
});

/* --------------------------------------------------------- delete reaction -- */

// reaction_added carries the channel on event.item.channel; there is no
// top-level event.channel. Reading the wrong one made every lookup below run
// with channel: undefined, and the Slack error was swallowed at log.debug, so
// :pixl-delete: did nothing and said nothing.
test("onReactionAdded deletes pixie's own message on :pixl-delete:", async () => {
  const deleted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "pixl-delete",
      user: "U-someone",
      item: { type: "message", channel: "C0DEL", ts: "800.1" },
    },
    client: {
      conversations: {
        history: async (args) => {
          assert.equal(args.channel, "C0DEL", "history must read the item's channel");
          return { messages: [{ user: "U0PIXIE", ts: "800.1" }] };
        },
      },
      chat: { delete: async (args) => { deleted.push(args); return { ok: true }; } },
    },
  });

  assert.equal(deleted.length, 1, "pixie's own message should have been deleted");
  assert.equal(deleted[0].channel, "C0DEL");
  assert.equal(deleted[0].ts, "800.1");
});

test("onReactionAdded does not delete a message pixie did not write", async () => {
  const deleted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "pixl-delete",
      user: "U-someone",
      item: { type: "message", channel: "C0DEL", ts: "801.1" },
    },
    client: {
      conversations: { history: async () => ({ messages: [{ user: "U-human", ts: "801.1" }] }) },
      chat: { delete: async (args) => { deleted.push(args); return { ok: true }; } },
    },
  });

  assert.equal(deleted.length, 0, "only pixie's own messages may be deleted this way");
});

// Same root cause, second symptom: the next guide step was posted to
// channel: undefined.
test("onReactionAdded posts the next guide step to the item's channel", async () => {
  const guides = require("./guides");
  guides.startGuide("submit-ysws-guidelines", "thread-reaction-channel", "U-owner");
  db.setGuideMessageTs("thread-reaction-channel", "802.1");

  const posted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "upvote",
      user: "U-owner",
      item: { type: "message", channel: "C0GUIDE", ts: "802.1" },
      item_user: "U0PIXIE",
    },
    client: { chat: { postMessage: async (args) => { posted.push(args); return { ts: "802.2" }; } } },
  });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].channel, "C0GUIDE", "the step must go to the channel the reaction was in");
});

// conversations.history only returns top-level channel messages, never thread
// replies — and pixie answers in threads. Looking the message up by ts found
// nothing, so the ownership check failed and the delete silently did not
// happen. It also needed channel membership pixie does not always have.
// reaction_added already carries item_user, the message's author, so no
// lookup is needed at all.
test("onReactionAdded deletes a threaded reply using item_user, with no history call", async () => {
  const deleted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "pixl-delete",
      user: "U-someone",
      item: { type: "message", channel: "C0DEL", ts: "900.1" },
      item_user: "U0PIXIE",
    },
    client: {
      conversations: { history: async () => { throw new Error("history must not be called"); } },
      chat: { delete: async (args) => { deleted.push(args); return { ok: true }; } },
    },
  });

  assert.equal(deleted.length, 1, "a threaded reply by pixie should still be deletable");
  assert.equal(deleted[0].channel, "C0DEL");
  assert.equal(deleted[0].ts, "900.1");
});

test("onReactionAdded ignores :pixl-delete: on a message item_user says is not pixie's", async () => {
  const deleted = [];
  await handlers.onReactionAdded({
    event: {
      reaction: "pixl-delete",
      user: "U-someone",
      item: { type: "message", channel: "C0DEL", ts: "901.1" },
      item_user: "U-human",
    },
    client: {
      conversations: { history: async () => { throw new Error("history must not be called"); } },
      chat: { delete: async (args) => { deleted.push(args); return { ok: true }; } },
    },
  });

  assert.equal(deleted.length, 0);
});
