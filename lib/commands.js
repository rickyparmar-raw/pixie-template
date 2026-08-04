// Slash commands and the channel-join welcome. All answers here are ephemeral or
// private by default — the point is getting help without adding noise to a
// busy channel. The App Home tab lives in home.js.
const knowledge = require("./knowledge");
const answer = require("./answer");
const respond = require("./respond");
const reply = require("./reply");
const context = require("./context");
const learn = require("./learn");
const teachThread = require("./teachThread");
const home = require("./home");
const report = require("./report");
const db = require("./db");
const log = require("./log");
const brand = require("./brand");
const { config, isAdmin } = require("./config");
const { relativeTime, statsText } = require("./stats");

const GAP_LIMIT = 15;
const PENDING_LIMIT = 15;
const NOT_ALLOWED = "that one's helpers-only :nono:";

// Wraps a command so it only runs for PIXIE_ADMIN_USER_IDS. Used for anything
// that changes what pixie knows or exposes the maintainer view.
function adminOnly(handler) {
  return async (args) => {
    if (!isAdmin(args.command?.user_id)) {
      await args.ack();
      await args.respond({ response_type: "ephemeral", text: NOT_ALLOWED });
      return;
    }
    await handler(args);
  };
}

// Slash commands reply through Bolt's own `respond` helper rather than through
// lib/reply.js, so they miss the de-dashing every other reply gets. Wrapping
// the helper once here covers all of them, including `/pixie <question>`.
function plainSpoken(handler) {
  return async (args) => {
    const original = args.respond;
    const respond = typeof original === "function"
      ? async (payload) => {
          if (payload && typeof payload === "object") {
            return original({
              ...payload,
              ...(payload.text ? { text: reply.plainDashes(payload.text) } : {}),
              ...(payload.blocks ? { blocks: reply.plainDashesInBlocks(payload.blocks) } : {}),
            });
          }
          return original(reply.plainDashes(payload));
        }
      : original;
    return handler({ ...args, respond });
  };
}

// Same allowlist as adminOnly, but for shortcut args ({shortcut, ack, client}
// rather than {command, ack, respond}) — a message shortcut has no `respond`
// helper of its own the way a slash command does.
function adminOnlyShortcut(handler) {
  return async (args) => {
    if (!isAdmin(args.shortcut?.user?.id)) {
      await args.ack();
      await args.client.chat.postEphemeral({
        channel: args.shortcut.channel.id,
        user: args.shortcut.user.id,
        text: NOT_ALLOWED,
      });
      return;
    }
    await handler(args);
  };
}


/* ------------------------------------------------------ /pixie-report ---- */

// The same builder the scheduled Monday post uses, so the two can never quote
// different numbers. `last` gets the previous week instead of this one.
async function reportCommand({ command, ack, respond: sendEphemeral }) {
  await ack();

  const weeksAgo = (command.text || "").trim().toLowerCase() === "last" ? 1 : 0;
  await sendEphemeral({ response_type: "ephemeral", text: report.reportText(weeksAgo) });
}

/* ------------------------------------------------------------- /pixie ---- */

// Ephemeral answer: same pipeline, but only the asker sees it.
async function askCommand({ command, ack, respond: sendEphemeral }) {
  await ack();

  const question = (command.text || "").trim();
  if (!question) {
    await sendEphemeral({ response_type: "ephemeral", text: `ask me something! e.g. \`${brand.cmd()} how do i unlock the next region\`` });
    return;
  }

  try {
    const result = await respond.lookupAnswer(question, "");
    if (result) {
      await sendEphemeral({
        response_type: "ephemeral",
        text: `${result.answer}${respond.sourceLineFor(result.source)}`,
      });
      db.recordMetric("answer_docs");
      return;
    }

    db.recordGap(question, command.user_id, command.channel_id);
    const { getChatReply } = require("./chat");
    const chatReply = await getChatReply(question, "", command.channel_id === config.slack.helpChannel);
    await sendEphemeral({ response_type: "ephemeral", text: chatReply || respond.MENTION_FALLBACK });
    db.recordMetric(chatReply ? "answer_chat" : "fallback");
  } catch (e) {
    log.error("commands", `${brand.cmd()} failed:`, e.message);
    await sendEphemeral({ response_type: "ephemeral", text: respond.ERROR_FALLBACK });
  }
}

/* --------------------------------------------------------- /pixie-check ---- */

const validator = require("./validator");

async function checkCommand({ command, ack, respond: sendEphemeral }) {
  await ack();
  const input = (command.text || "").trim();
  if (!input) {
    await sendEphemeral({
      response_type: "ephemeral",
      text: `Provide a public GitHub repo URL to check, e.g. \`${brand.cmd("check")} https://github.com/user/cool-game\``,
    });
    return;
  }

  try {
    const report = await validator.validateRepository(input);
    const replyText = validator.formatValidationReport(report);
    await sendEphemeral({ response_type: "ephemeral", text: replyText });
    db.recordMetric("command_check");
  } catch (e) {
    log.error("commands", `${brand.cmd("check")} failed:`, e.message);
    await sendEphemeral({ response_type: "ephemeral", text: `Could not inspect repository: ${e.message}` });
  }
}

/* ---------------------------------------------------------- /pixie-calc ---- */

async function calcCommand({ command, ack, respond: sendEphemeral }) {
  await ack();
  const input = (command.text || "").trim();
  if (!input) {
    await sendEphemeral({
      response_type: "ephemeral",
      text: `Calculate program rewards, e.g.:\n• \`${brand.cmd("calc")} 20 approved hours\`\n• \`${brand.cmd("calc")} how many hours for GoPro\`\n• \`${brand.cmd("calc")} what unlocks with 15 hours\``,
    });
    return;
  }

  try {
    const prog = programs.forChannel(command.channel_id);
    const lookupResult = await respond.lookupAnswer(input, "", prog, command.channel_id);
    if (lookupResult) {
      await sendEphemeral({ response_type: "ephemeral", text: lookupResult.answer });
      db.recordMetric("command_calc");
      return;
    }
    await sendEphemeral({
      response_type: "ephemeral",
      text: `Couldn't calculate a program reward for "${input}". Try approved hours (e.g. \`15 hours\`) or a reward name.`,
    });
  } catch (e) {
    log.error("commands", `${brand.cmd("calc")} failed:`, e.message);
    await sendEphemeral({ response_type: "ephemeral", text: respond.ERROR_FALLBACK });
  }
}

/* ------------------------------------------------------- /pixie-sources -- */

async function sourcesCommand({ ack, respond: sendEphemeral }) {
  await ack();

  let sources = [];
  try {
    sources = knowledge.loadSources();
  } catch (e) {
    await sendEphemeral({ response_type: "ephemeral", text: `couldn't read sources.json: ${e.message}` });
    return;
  }

  const lines = sources.map((s) => `• *${s.name}* — \`${s.type}\``);
  const built = knowledge.lastBuiltAt;
  await sendEphemeral({
    response_type: "ephemeral",
    text: [
      `*what i know* (${sources.length} source${sources.length === 1 ? "" : "s"})`,
      ...lines,
      "",
      `_last refreshed ${relativeTime(built?.getTime())}, auto-refresh every ${config.refreshIntervalMin}m_`,
    ].join("\n"),
  });
}

/* -------------------------------------------------------- /pixie-reload -- */

async function reloadCommand({ ack, respond: sendEphemeral }) {
  await ack();
  try {
    // force=true — someone explicitly asked to reload the docs, so a cached
    // Firecrawl copy from earlier today isn't good enough here.
    await knowledge.refreshCorpus(true);
    const { clearCache } = db;
    clearCache();
    await sendEphemeral({
      response_type: "ephemeral",
      text: "refreshed the docs and cleared the answer cache :yesyes:",
    });
  } catch (e) {
    await sendEphemeral({ response_type: "ephemeral", text: `refresh failed: ${e.message}` });
  }
}

/* ---------------------------------------------------------- /pixie-gaps -- */

// The docs to-do list: what people asked that the docs couldn't answer.
async function gapsCommand({ ack, respond: sendEphemeral }) {
  await ack();

  // Only questions judged to be real docs gaps. A miss is not the same claim as
  // "the docs should cover this" — an outage, someone's broken laptop and a
  // half-typed fragment all used to land here, which is why the list went
  // unread. See lib/report.js.
  const gaps = db.topGaps(GAP_LIMIT, undefined, { kind: report.DOCS });
  if (gaps.length === 0) {
    await sendEphemeral({ response_type: "ephemeral", text: "no unanswered questions logged yet :yay:" });
    return;
  }

  const lines = gaps.map((g, i) => `${i + 1}. *${g.ask_count}×* — ${g.question.slice(0, 160)}`);
  await sendEphemeral({
    response_type: "ephemeral",
    text: ["*questions the docs didn't cover* (last 30d)", ...lines, "", "_worth adding these to the docs_"].join("\n"),
  });
}

/* --------------------------------------------------------- /pixie-stats -- */

async function statsCommand({ ack, respond: sendEphemeral }) {
  await ack();
  await sendEphemeral({ response_type: "ephemeral", text: statsText() });
}

/* ------------------------------------------------------- learning loop --- */

async function teachCommand({ command, ack, respond: sendEphemeral, client }) {
  await ack();

  const text = (command.text || "").trim();
  const parsed = learn.parseTeach(text);
  if (parsed) {
    const id = learn.teach({ ...parsed, authorId: command.user_id });
    await sendEphemeral({
      response_type: "ephemeral",
      text: id
        ? `got it, i'll use that from now on :yesyes:\n>*Q:* ${parsed.question}\n>*A:* ${parsed.answer}\n\n_#${id} — remove it with \`/pixie-forget ${id}\`_`
        : "couldn't save that one, try again",
    });
    return;
  }

  // If no "Q :: A" syntax was given, attempt to summarize the thread
  let threadTs = command.thread_ts;
  const channel = command.channel_id;
  const user = command.user_id;

  if (!threadTs && client && client.conversations && client.conversations.history) {
    try {
      const history = await client.conversations.history({ channel, limit: 10 });
      const recentWithThread = (history.messages || []).find((m) => m.thread_ts || (m.reply_count && m.reply_count > 0));
      if (recentWithThread) {
        threadTs = recentWithThread.thread_ts || recentWithThread.ts;
      }
    } catch (e) {
      log.debug("commands", `could not inspect channel history for thread: ${e.message}`);
    }
  }

  if (threadTs && client) {
    try {
      const threadResult = await teachThread.summarizeThread({ client, channel, threadTs });
      if (threadResult) {
        const id = learn.teach({ ...threadResult, authorId: user, threadTs, channel });
        await sendEphemeral({
          response_type: "ephemeral",
          text: id
            ? `🧚 Summarized and added this thread to active memory! :yesyes:\n>*Q:* ${threadResult.question}\n>*A:* ${threadResult.answer}\n\n_#${id} — remove with \`/pixie-forget ${id}\`_`
            : "already memorized this thread or couldn't save it",
        });
        return;
      }
    } catch (e) {
      log.error("commands", "teach thread failed:", e.message);
    }
  }

  await sendEphemeral({
    response_type: "ephemeral",
    text: `use \`${brand.cmd("teach")} <question> ${learn.TEACH_SEPARATOR} <answer>\` or run \`${brand.cmd("teach")}\` inside a thread to memorize the thread!`,
  });
}

// "Teach Pixie from thread" message shortcut — right-click a message → app actions.
async function teachThreadShortcut({ shortcut, ack, client }) {
  await ack();

  const channel = shortcut.channel.id;
  const threadTs = shortcut.message.thread_ts || shortcut.message_ts;
  const user = shortcut.user.id;

  try {
    const parsed = await teachThread.summarizeThread({ client, channel, threadTs });
    if (!parsed) {
      await client.chat.postEphemeral({
        channel,
        user,
        text: "couldn't find a clear question and answer in that thread",
      });
      return;
    }

    const id = learn.captureFromThread({ ...parsed, authorId: user, threadTs, channel });
    await client.chat.postEphemeral({
      channel,
      user,
      text: id
        ? `queued for review :thinking_face:\n>*Q:* ${parsed.question}\n>*A:* ${parsed.answer}\n\n_#${id} — approve with \`/pixie-approve ${id}\`, or \`/pixie-forget ${id}\` to drop it_`
        : `already queued this thread, or couldn't save it — check \`${brand.cmd("pending")}\``,
    });
  } catch (e) {
    log.error("commands", "teach-thread shortcut failed:", e.message);
    await client.chat.postEphemeral({ channel, user, text: respond.ERROR_FALLBACK });
  }
}

// Candidates captured from helpers answering in threads pixie missed.
async function pendingCommand({ ack, respond: sendEphemeral }) {
  await ack();

  const rows = learn.pending(PENDING_LIMIT);
  if (rows.length === 0) {
    await sendEphemeral({ response_type: "ephemeral", text: "nothing waiting for review :yay:" });
    return;
  }

  const lines = rows.map(
    (r) =>
      `*#${r.id}* — asked: _${r.question.slice(0, 100)}_\n` +
      `> ${r.answer.slice(0, 240)}\n` +
      `> _from <@${r.author_id}>, ${relativeTime(r.created_at)}_`,
  );

  await sendEphemeral({
    response_type: "ephemeral",
    text: [
      "*answers waiting for review*",
      ...lines,
      "",
      `_\`${brand.cmd("approve")} <n>\` to start using one, \`${brand.cmd("forget")} <n>\` to drop it_`,
    ].join("\n"),
  });
}

function parseId(text) {
  const id = Number((text || "").trim().replace(/^#/, ""));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseForgetInput(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  if (raw === "all") return { type: "all" };
  if (raw.toLowerCase() === "pending") return { type: "pending" };

  const rangeMatch = raw.match(/^#?(\d+)\s*-\s*#?(\d+)$/);
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1], 10);
    const to = parseInt(rangeMatch[2], 10);
    if (from > 0 && to >= from) {
      return { type: "range", from, to };
    }
  }

  const id = parseId(raw);
  if (id) return { type: "id", id };

  return null;
}

async function approveCommand({ command, ack, respond: sendEphemeral }) {
  await ack();

  const id = parseId(command.text);
  if (!id) {
    await sendEphemeral({ response_type: "ephemeral", text: `use \`${brand.cmd("approve")} <n>\` — get the number from \`${brand.cmd("pending")}\`` });
    return;
  }

  await sendEphemeral({
    response_type: "ephemeral",
    text: learn.approve(id) ? `approved #${id} — i'll use it from now on :yesyes:` : `couldn't find #${id}`,
  });
}

async function forgetCommand({ command, ack, respond: sendEphemeral }) {
  await ack();

  const parsed = parseForgetInput(command.text);
  if (!parsed) {
    await sendEphemeral({
      response_type: "ephemeral",
      text: `use \`${brand.cmd("forget")} <n>\`, \`${brand.cmd("forget")} <from>-<to>\`, \`${brand.cmd("forget")} pending\`, or \`${brand.cmd("forget")} all\``,
    });
    return;
  }

  if (parsed.type === "all") {
    const count = learn.forgetByStatus("all");
    await sendEphemeral({
      response_type: "ephemeral",
      text: count > 0 ? `forgot all ${count} learned fact${count === 1 ? "" : "s"}` : "no learned facts to forget",
    });
    return;
  }

  if (parsed.type === "pending") {
    const count = learn.forgetByStatus("pending");
    await sendEphemeral({
      response_type: "ephemeral",
      text: count > 0 ? `forgot ${count} pending fact${count === 1 ? "" : "s"}` : "no pending facts to forget",
    });
    return;
  }

  if (parsed.type === "range") {
    const count = learn.forgetRange(parsed.from, parsed.to);
    await sendEphemeral({
      response_type: "ephemeral",
      text: count > 0 ? `forgot ${count} fact${count === 1 ? "" : "s"} (#${parsed.from}-#${parsed.to})` : `no facts found in range #${parsed.from}-#${parsed.to}`,
    });
    return;
  }

  if (parsed.type === "id") {
    await sendEphemeral({
      response_type: "ephemeral",
      text: learn.forget(parsed.id) ? `forgot #${parsed.id}` : `couldn't find #${parsed.id}`,
    });
  }
}

/* ---------------------------------------------------------- onboarding --- */

// Built per call rather than at require time: brand.cmd() reads the environment,
// and a module-level constant would freeze whichever value was set first.
function welcomeText() {
  const prog = programs.all()[0] || null;
  const links = prog?.links || {};
  const help = prog?.helpChannel ? `<#${prog.helpChannel}>` : "the help channel";
  return [
    `hey! welcome to ${prog?.name || "this YSWS"} :yay:`,
    "",
    `i'm ${brand.name()} — a helper bot for Hack Club YSWSs and build guides. you can:`,
    "• ping me in any channel",
    "• DM me right here",
    `• use \`${brand.cmd()} <question>\` for a private answer`,
    "",
    "quick links:",
    ...(links.site ? [`• site: ${links.site}`] : []),
    ...(links.docs ? [`• docs: ${links.docs}`] : []),
    "",
    `stuck on something a helper should see? post in ${help} :hii:`,
  ].join("\n");
}

// Channel join welcome DMs are disabled per user request
async function onMemberJoined() {
  // No-op: do not DM members joining channels
}

/* ------------------------------------------------------- /pixie-program -- */

const programs = require("./programs");

async function programCommand({ command, ack, respond: sendEphemeral }) {
  await ack();
  const raw = (command.text || "").trim();
  if (!raw || raw.toLowerCase() === "list") {
    const allProgs = programs.all();
    const lines = allProgs.map((p) =>
      `• *${p.id}* (${p.name}): posture=\`${p.posture || "active"}\`, scope=\`${p.scope || "any"}\`, help_channel=\`${p.helpChannel || "none"}\`, channels=[\`${(p.channels || []).join("`, `")}\`]`,
    );
    await sendEphemeral({
      response_type: "ephemeral",
      text: [`*registered programs* (${allProgs.length})`, ...lines].join("\n"),
    });
    return;
  }

  const parts = raw.split(/\s+/);
  const sub = parts[0].toLowerCase();

  if (sub === "add") {
    const jsonText = raw.slice(parts[0].length).trim();
    try {
      let progObj = null;
      if (jsonText.startsWith("{")) {
        progObj = JSON.parse(jsonText);
      } else {
        const id = parts[1];
        const name = parts.slice(2).join(" ");
        if (!id || !name) {
          await sendEphemeral({ response_type: "ephemeral", text: `usage: \`${brand.cmd("program")} add <id> <name>\` or \`${brand.cmd("program")} add <json>\`` });
          return;
        }
        progObj = { id, name, posture: "active" };
      }
      programs.saveProgram(progObj);
      await sendEphemeral({ response_type: "ephemeral", text: `saved program \`${progObj.id}\` :yesyes:` });
    } catch (e) {
      await sendEphemeral({ response_type: "ephemeral", text: `could not add program: ${e.message}` });
    }
    return;
  }

  if (sub === "set") {
    const id = parts[1];
    const field = parts[2]?.toLowerCase();
    const val = parts[3]?.toLowerCase();
    const allowed = { posture: ["active", "passive"], scope: ["any", "program"] };
    // hasOwnProperty, not a bare lookup: `field` is whatever someone typed into
    // Slack, and `allowed["constructor"]` is not an array.
    const choices = Object.prototype.hasOwnProperty.call(allowed, field) ? allowed[field] : null;
    if (!id || !choices || !choices.includes(val)) {
      await sendEphemeral({
        response_type: "ephemeral",
        text: [
          `usage: \`${brand.cmd("program")} set <id> posture active|passive\``,
          `       \`${brand.cmd("program")} set <id> scope any|program\``,
          "",
          "• `scope any` — answers anything someone's stuck on (default)",
          `• \`scope program\` — only answers questions about that program. anything else asked in the channel is left to the humans, unless someone pings ${brand.name()} directly.`,
        ].join("\n"),
      });
      return;
    }
    const existing = programs.get(id);
    if (!existing) {
      await sendEphemeral({ response_type: "ephemeral", text: `program \`${id}\` not found` });
      return;
    }
    const updated = { ...existing, [field]: val };
    programs.saveProgram(updated);
    await sendEphemeral({ response_type: "ephemeral", text: `updated \`${id}\` ${field} to \`${val}\` :yesyes:` });
    return;
  }

  if (sub === "remove" || sub === "delete") {
    const id = parts[1];
    if (!id) {
      await sendEphemeral({ response_type: "ephemeral", text: `usage: \`${brand.cmd("program")} remove <id>\`` });
      return;
    }
    programs.removeProgram(id);
    await sendEphemeral({ response_type: "ephemeral", text: `removed program \`${id}\` :yesyes:` });
    return;
  }

  await sendEphemeral({ response_type: "ephemeral", text: "unknown subcommand. use `list`, `add`, `set`, or `remove`" });
}

/* ----------------------------------------------------------------- /guide -- */

const guides = require("./guides");

async function guideCommand({ command, ack, respond: sendEphemeral, client }) {
  await ack();
  const text = (command.text || "").trim();
  const channel = command.channel_id;
  const user = command.user_id;
  const prog = programs.forChannel(channel);

  if (text) {
    const guideId = guides.detectGuideByKeyword(text) || (guides.GUIDES[text] ? text : null);
    if (guideId && guides.isAvailable(prog, guideId)) {
      const guideName = guides.GUIDES[guideId]?.name || guideId;
      if (client && client.chat && client.chat.postMessage) {
        const root = await client.chat.postMessage({
          channel,
          text: reply.plainDashes(`📖 <@${user}> started the *${guideName}* walkthrough! Follow along in the thread below 👇`),
        });
        const threadTs = root.ts;
        const result = guides.startGuide(guideId, threadTs, user);
        if (result) {
          const guideText = respond.formatGuideText(result);
          const blocks = guides.buildGuideBlocks(result, config.web.baseUrl, { showReactionHint: true });
          const posted = await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: reply.plainDashes(guideText),
            blocks: reply.plainDashesInBlocks(blocks),
          });
          db.setGuideMessageTs(threadTs, posted.ts);
          context.addToThread(threadTs, "assistant", guideText, null, channel);
          return;
        }
      } else {
        const result = guides.startGuide(guideId, command.trigger_id || Date.now().toString(), user);
        if (result) {
          const guideText = respond.formatGuideText(result);
          const blocks = guides.buildGuideBlocks(result, config.web.baseUrl, { showReactionHint: true });
          await sendEphemeral({ response_type: "in_channel", text: guideText, blocks });
          return;
        }
      }
    }
  }

  const allGuides = guides.availableFor(prog);

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📖 *Interactive Walkthrough Guides* (${prog ? prog.name : "YSWS"})\n<@${user}>, pick a guide below to start the step-by-step walkthrough in a thread:`,
      },
    },
  ];

  const buttons = allGuides.map(([id, g]) => ({
    type: "button",
    text: { type: "plain_text", text: g.name.slice(0, 75) },
    value: id,
    action_id: `start_guide_${id}`,
  }));

  for (let i = 0; i < buttons.length; i += 5) {
    blocks.push({
      type: "actions",
      elements: buttons.slice(i, i + 5),
    });
  }

  if (client && client.chat && client.chat.postMessage) {
    await client.chat.postMessage({
      channel,
      text: `📖 *Interactive Walkthrough Guides* (${prog ? prog.name : "YSWS"})`,
      blocks: reply.plainDashesInBlocks(blocks),
    });
  } else {
    await sendEphemeral({
      response_type: "in_channel",
      blocks,
      text: "Interactive Walkthrough Guides",
    });
  }
}

/* ----------------------------------------------------------- registration -- */

const tickets = require("./tickets");

function register(app) {
  // Command names come from the bot's own slug (lib/brand.js), not from literals:
  // one image serves the whole fleet, and a bot deployed as Sol must answer /sol.
  // The Slack manifest is generated from the same slug, so what the app advertises
  // and what this process listens for cannot drift apart.
  //
  // With no PIXIE_BOT_SLUG set these resolve to /pixie and /pixie-* exactly as
  // before, so the live Pixl deployment is unaffected.
  const cmd = brand.cmd;

  app.command(cmd(), plainSpoken(askCommand));
  app.command(cmd("sources"), plainSpoken(sourcesCommand));
  app.command(cmd("stats"), plainSpoken(statsCommand));
  app.command(cmd("guide"), plainSpoken(guideCommand));
  app.command(cmd("check"), plainSpoken(checkCommand));
  app.command(cmd("calc"), plainSpoken(calcCommand));

  // Maintainer surface: changes what pixie knows, or exposes the review queue.
  app.command(cmd("report"), plainSpoken(adminOnly(reportCommand)));
  app.command(cmd("reload"), plainSpoken(adminOnly(reloadCommand)));
  app.command(cmd("gaps"), plainSpoken(adminOnly(gapsCommand)));
  app.command(cmd("teach"), plainSpoken(adminOnly(teachCommand)));
  app.command(cmd("pending"), plainSpoken(adminOnly(pendingCommand)));
  app.command(cmd("approve"), plainSpoken(adminOnly(approveCommand)));
  app.command(cmd("forget"), plainSpoken(adminOnly(forgetCommand)));
  app.command(cmd("program"), plainSpoken(adminOnly(programCommand)));

  // Unprefixed alias, kept because people on Pixl already type it. Registered
  // only for the default bot: /guide can belong to exactly one app per workspace,
  // and every fleet bot shares the Hack Club workspace — a second bot claiming it
  // would fail to install.
  if (brand.slug() === brand.DEFAULT_SLUG) {
    app.command("/guide", plainSpoken(guideCommand));
  }

  tickets.registerActions(app);

  app.action(/^start_guide_.+$/, async ({ action, body, ack, client }) => {
    await ack();
    const guideId = action.value;
    const channelId = body.channel?.id;
    const rootTs = body.message?.ts;
    const threadTs = body.message?.thread_ts || rootTs;
    const userId = body.user?.id;

    if (!guideId || !channelId || !userId || !threadTs) return;
    const prog = programs.forChannel(channelId);
    if (!guides.isAvailable(prog, guideId)) return;

    const guideName = guides.GUIDES[guideId]?.name || guideId;

    // Remove the button menu and replace with a clean confirmation
    if (rootTs && client && client.chat && client.chat.update) {
      await client.chat
        .update({
          channel: channelId,
          ts: rootTs,
          text: `📖 <@${userId}> selected *${guideName}*! Follow along in the thread below 👇`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `📖 <@${userId}> selected *${guideName}*! Follow along in the thread below 👇`,
              },
            },
          ],
        })
        .catch((e) => log.debug("commands", `could not update guide menu message: ${e.message}`));
    }

    const result = guides.startGuide(guideId, threadTs, userId);
    if (!result) return;

    const text = respond.formatGuideText(result);
    const blocks = guides.buildGuideBlocks(result, config.web.baseUrl, { showReactionHint: true });

    const posted = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: reply.plainDashes(text),
      blocks,
    });

    db.setGuideMessageTs(threadTs, posted.ts);
    context.addToThread(threadTs, "assistant", text, null, channelId);
  });

  app.shortcut(brand.id("teach_thread"), adminOnlyShortcut(teachThreadShortcut));

  app.event("member_joined_channel", onMemberJoined);

  home.register(app);
}

module.exports = {
  register,
  adminOnly,
  adminOnlyShortcut,
  plainSpoken,
  askCommand,
  sourcesCommand,
  reloadCommand,
  gapsCommand,
  statsCommand,
  teachCommand,
  teachThreadShortcut,
  pendingCommand,
  approveCommand,
  forgetCommand,
  programCommand,
  guideCommand,
  checkCommand,
  calcCommand,
  parseId,
  parseForgetInput,
  onMemberJoined,
  welcomeText,
  // Kept as a getter so `commands.WELCOME` still reads as a string for any
  // existing caller, while the text itself is built fresh from the bot's brand.
  get WELCOME() {
    return welcomeText();
  },
};
