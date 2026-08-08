// Bootstrap. Event routing lives in lib/handlers.js, the answering pipeline in
// lib/respond.js, slash commands and the home tab in lib/commands.js.
const { App } = require("@slack/bolt");
const { config, validate, resolveBotUserId } = require("./lib/config");
const knowledge = require("./lib/knowledge");
const handlers = require("./lib/handlers");
const commands = require("./lib/commands");
const guides = require("./lib/guides");
const respond = require("./lib/respond");
const warm = require("./lib/warm");
const report = require("./lib/report");
const web = require("./lib/web/serve");
const db = require("./lib/db");
const log = require("./lib/log");

// Measured: the first request after an idle stretch costs ~2000ms against
// ~1250ms warm — a TLS handshake pixie pays for because a help channel is quiet
// between questions, which is exactly when the socket gets dropped. GET /models
// returns 200 and costs no tokens; it exists here only to hold the connection
// open so the next real question doesn't pay for one.
const KEEPALIVE_INTERVAL_MS = 60 * 1000;

function startKeepAlive() {
  return setInterval(() => {
    const key = config.zenApiKeys?.[0] || (typeof config.answer.apiKey === "function" ? config.answer.apiKey() : config.answer.apiKey);
    fetch(`${config.answer.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    }).catch((e) => log.debug("keepalive", `ping failed: ${e.message}`));
  }, KEEPALIVE_INTERVAL_MS);
}

async function startBot() {
  validate({ needsSlack: true });
  db.open();
  db.startSweeper();

  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  app.event("message", handlers.onMessage);
  app.event("app_mention", handlers.onAppMention);
  app.event("reaction_added", handlers.onReactionAdded);
  app.event("reaction_removed", handlers.onReactionRemoved);
  commands.register(app);

  // Bolt swallows listener errors by default; surfacing them keeps a broken
  // handler from silently making pixie mute.
  app.error(async (error) => {
    log.error("bolt", error.message);
  });

  // The warmer answers the FAQ once the corpus is actually loaded — starting it
  // first would have it asking questions against an empty knowledge base.
  knowledge
    .refreshCorpus()
    .then(() => warm.start())
    .catch((e) => log.error("knowledge", "initial corpus build failed:", e.message));
  knowledge.startAutoRefresh(config.refreshIntervalMin);
  startKeepAlive();
  // Judges the unclassified gap backlog on a slow loop, and posts the weekly
  // report once it's due. Both are background work — see lib/report.js.
  report.start(app.client);

  // Web console: starts if SLACK_CLIENT_ID is set, silently skipped otherwise.
  const webServer = web.start();
  if (webServer) {
    const api = require("./lib/web/api");
    api.setSlackClient(app.client);
  }

  await app.start();
  // Mention detection compares against this, so it has to be resolved before
  // the first message is handled in earnest.
  const botUserId = await resolveBotUserId(app.client);
  log.info("bot", `connected via Socket Mode as ${botUserId}`);

  // Automatically join all configured public program channels
  try {
    const programs = require("./lib/programs");
    const channelList = programs.getChannelsList();
    for (const item of channelList) {
      if (item.channelId && item.channelId.startsWith("C")) {
        await app.client.conversations.join({ channel: item.channelId }).catch((e) => {
          log.debug("bot", `could not auto-join channel ${item.channelId}: ${e.message}`);
        });
      }
    }
  } catch (e) {
    log.debug("bot", `auto-join error: ${e.message}`);
  }
}

// Offline test mode: `bun index.js --ask "how do i join pixl?"` builds the
// corpus and prints what pixie would reply, no Slack connection needed.
async function runAskCli(question) {
  validate({ needsSlack: false });
  db.open();
  await knowledge.refreshCorpus();

  const guideId = await guides.detectGuideIntent(question);
  if (guideId) {
    const result = guides.startGuide(guideId, "cli-test", "cli-user");
    console.log(`[pixie] would start guide: "${guideId}"`);
    console.log(`[pixie] first message: ${result.message}`);
    if (result.checkNext) console.log(`[pixie] prompt: ${result.checkNext}`);
    guides.cancelGuide("cli-test");
    return;
  }

  // Same single call the mention path uses, so what --ask prints is what Slack
  // would get. A null source means the docs didn't cover it and the reply is
  // conversational.
  const result = await respond.answerOrChat(question, "");
  if (result?.answer) {
    console.log(`[pixie] source: ${result.source || "(conversational — not in docs)"}`);
    console.log(`[pixie] answer: ${result.answer}`);
    return;
  }

  console.log(`[pixie] would show the fallback: "${respond.MENTION_FALLBACK}"`);
}

function main() {
  process.on("unhandledRejection", (reason) => {
    log.error("process", "unhandled rejection:", reason?.message || reason);
  });

  const askIdx = process.argv.indexOf("--ask");
  if (askIdx !== -1) {
    const question = process.argv[askIdx + 1];
    if (!question) {
      console.error('Usage: bun index.js --ask "<question>"');
      process.exit(1);
    }
    runAskCli(question)
      .then(() => process.exit(0))
      .catch((e) => {
        console.error("[pixie] --ask failed:", e.message);
        process.exit(1);
      });
    return;
  }

  startBot().catch((e) => {
    console.error(`[pixie] failed to start: ${e.message}`);
    process.exit(1);
  });
}

main();
