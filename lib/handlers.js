

const { config, isAdmin } = require("./config");
const vision = require("./vision");
const { worthClassifying } = require("./intent");
const context = require("./context");
const respond = require("./respond");

const replyText = require("./reply");
const guides = require("./guides");
const learn = require("./learn");
const teachThread = require("./teachThread");
const db = require("./db");
const log = require("./log");
const programs = require("./programs");
const brand = require("./brand");

const DELETE_REACTION = "pixl-delete";
const UP_REACTIONS = new Set(["yay", "thumbs-up", "+1", "yesyes", "white_check_mark", "heavy_check_mark", "upvote", "sparkling_heart", "heart", "heart_eyes"]);
const DOWN_REACTIONS = new Set(["nono", "-1", "thumbsdown", "x", "sad-pf"]);
const GUIDE_ADVANCE_REACTION = "upvote";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsPixieByName(text) {
  const names = [...new Set([brand.name(), brand.slug()])].map(escapeRegex).join("|");
  return new RegExp(`\\b(?:${names})\\w*\\b`, "i").test(text || "");
}

function teachPattern(mentionOnly = false) {
  const slug = escapeRegex(brand.slug());
  const base = mentionOnly ? `teach|learn|remember|memorize|!teach|/${slug}-teach` : `!teach|${slug}-teach|/${slug}-teach|teach\\s+this|teach\\s+thread`;
  return new RegExp(`^\\s*(?:${base})\\b`, "i");
}

function stripTeachCommand(text, mentionOnly = false) {
  return String(text || "").replace(teachPattern(mentionOnly), "").trim();
}

function mentionsPixieDirectly(text) {
  const id = config.slack.botUserId;
  return !!id && (text || "").includes(`<@${id}>`);
}

function stripBotMention(text) {
  const id = config.slack.botUserId;
  if (!id) return (text || "").trim();
  return (text || "").replace(new RegExp(`<@${id}>`, "g"), "").trim();
}

function isDirectMessage(event) {
  return event.channel_type === "im";
}

function findImage(event) {
  if (!event.files?.length) return null;
  return event.files.find((f) => f.mimetype?.startsWith("image/") && f.url_private) || null;
}

async function handleImage({ event, client, imageFile }) {
  const threadTs = event.thread_ts || event.ts;
  const question = stripBotMention(event.text);

  try {
    context.addToThread(threadTs, "user", `[uploaded image] ${question}`, event.user, event.channel);
    const reply = await vision.analyzeImage(
      imageFile.url_private,
      question,
      context.getThreadContext(threadTs),
      config.slack.botToken,
    );

    if (reply) {
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: replyText.plainDashes(reply) });
      context.addToThread(threadTs, "assistant", reply, null, event.channel);
      context.updateUserHistory(event.user, question || "image analysis", true);
      db.recordMetric("answer_vision");
    }
  } catch (e) {
    log.error("vision", "analysis failed:", e.message);
    await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text: replyText.plainDashes(respond.ERROR_FALLBACK) });
  }
}

function shouldConsiderThreadReply(event) {
  if (!event.thread_ts || event.thread_ts === event.ts) return true;
  if (db.isThreadMuted(event.thread_ts)) {
    return mentionsPixieDirectly(event.text);
  }
  if (mentionsPixieByName(event.text) || mentionsPixieDirectly(event.text)) return true;
  if (db.getGuide(event.thread_ts)) return true;
  return context.hasSpokenInThread(event.thread_ts);
}

async function onMessage({ event, client }) {
  if (event.bot_id || event.subtype === "bot_message") return;

  const allowedSubtypes = ["file_share"];
  if (event.subtype && !allowedSubtypes.includes(event.subtype)) return;

  const threadTs = event.thread_ts || event.ts;
  const question = (event.text || "").trim();
  const isDm = isDirectMessage(event);
  const named = mentionsPixieByName(question);
  const pinged = mentionsPixieDirectly(question);

  const prog = programs.forChannel(event.channel);
  const inHelpChannel = programs.isHelpChannel(event.channel);
  const isPassive = prog.posture === "passive";

  
  
  
  if (question) {
    db.recordUserMessage({ userId: event.user, channel: event.channel, threadTs, text: question });
  }

  log.debug(
    "message",
    `channel=${event.channel} dm=${isDm} thread=${event.thread_ts || "none"} ts=${event.ts} named=${named} pinged=${pinged} prog=${prog.id} posture=${prog.posture}`,
  );

  
  

  
  if (event.thread_ts && teachPattern().test(question)) {
    if (!isAdmin(event.user)) {
      await client.chat.postEphemeral({ channel: event.channel, user: event.user, text: "that one's helpers-only :nono:" });
      return;
    }
    if (!db.claimMessage(event.ts, event.channel)) return;

    
    const strippedCommand = stripTeachCommand(question);
    const parsedDirect = learn.parseTeach(strippedCommand);
    if (parsedDirect) {
      const id = learn.teach({ ...parsedDirect, authorId: event.user, threadTs: event.thread_ts, channel: event.channel });
      await client.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        thread_ts: event.thread_ts,
        text: id
          ? `🧚 Memorized for future questions! :yesyes:\n>*Q:* ${parsedDirect.question}\n>*A:* ${parsedDirect.answer}\n\n_#${id} — remove with \`${brand.cmd("forget")} ${id}\`_`
          : "already memorized or couldn't save it",
      });
      return;
    }

    try {
      const parsed = await teachThread.summarizeThread({ client, channel: event.channel, threadTs: event.thread_ts });
      if (!parsed) {
        await client.chat.postEphemeral({
          channel: event.channel,
          user: event.user,
          thread_ts: event.thread_ts,
          text: "couldn't find a clear question and answer in this thread to memorize",
        });
        return;
      }
      const id = learn.teach({ ...parsed, authorId: event.user, threadTs: event.thread_ts, channel: event.channel });
      await client.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        thread_ts: event.thread_ts,
        text: id
          ? `🧚 Memorized this thread for future questions! :yesyes:\n>*Q:* ${parsed.question}\n>*A:* ${parsed.answer}\n\n_#${id} — remove with \`${brand.cmd("forget")} ${id}\`_`
          : "already memorized this thread!",
      });
      return;
    } catch (e) {
      log.error("handlers", `!teach failed: ${e.message}`);
    }
  }

  const imageFile = findImage(event);
  if (imageFile) {
    const hasQuestion = question && question.trim().length > 0;
    const wanted = isDm || pinged || named || (inHelpChannel && hasQuestion);
    if (!wanted) return;
    if (!db.claimMessage(event.ts, event.channel)) return;
    await handleImage({ event, client, imageFile });
    return;
  }

  if (pinged) return;

  if (isDm) {
    if (!db.claimMessage(event.ts, event.channel)) return;
    await respond.respond({
      client,
      channel: event.channel,
      threadTs: event.thread_ts || undefined,
      userId: event.user,
      question,
      messageTs: event.ts,
      mode: respond.ALWAYS,
      seedClient: event.thread_ts ? client : null,
    });
    return;
  }

  const isProgChannel = (prog.channels && prog.channels.includes(event.channel)) || config.slack.faqChannels.includes(event.channel);

  if (named && !inHelpChannel && !isProgChannel) {
    if (!db.claimMessage(event.ts, event.channel)) return;
    await respond.respond({
      client,
      channel: event.channel,
      threadTs,
      userId: event.user,
      question,
      messageTs: event.ts,
      mode: respond.DOCS_ONLY,
      seedClient: client,
    });
    return;
  }

  if (isProgChannel && !inHelpChannel) {
    if (named) {
      if (!db.claimMessage(event.ts, event.channel)) return;
      await respond.respond({
        client,
        channel: event.channel,
        threadTs,
        userId: event.user,
        question,
        messageTs: event.ts,
        mode: isPassive ? respond.HELP_ONLY : respond.ALWAYS,
        seedClient: client,
        
        
        addressed: true,
      });
      return;
    }

    if (!shouldConsiderThreadReply(event)) {
      log.debug("intent", "skipping thread reply — pixie not in this thread");
      return;
    }

    if (!worthClassifying(question)) {
      log.debug("intent", "skipping model call — nothing but emoji or a bare reaction");
      context.addToThread(threadTs, "user", question, event.user, event.channel);
      db.recordMetric("silent", null, "no_content");
      return;
    }

    const inActiveGuide = !!db.getGuide(threadTs);
    if (!db.claimMessage(event.ts, event.channel)) return;
    await respond.respond({
      client,
      channel: event.channel,
      threadTs,
      userId: event.user,
      question,
      messageTs: event.ts,
      mode: inActiveGuide ? respond.ALWAYS : respond.HELP_ONLY,
      addressed: inActiveGuide,
      seedClient: client,
    });
    return;
  }

  if (!inHelpChannel) return;

  if (event.thread_ts && !named) {
    log.debug("intent", "skipping help thread reply — pixie not named or pinged");
    if (context.hasSpokenInThread(event.thread_ts)) {
      context.addToThread(threadTs, "user", question, event.user, event.channel);
    }
    db.recordMetric("silent", null, "not_named");
    return;
  }

  if (!db.claimMessage(event.ts, event.channel)) return;
  await respond.respond({
    client,
    channel: event.channel,
    threadTs,
    userId: event.user,
    question,
    messageTs: event.ts,
    mode: isPassive ? respond.HELP_ONLY : respond.ALWAYS,
    seedClient: event.thread_ts ? client : null,
    addressed: named,
  });
}

async function onAppMention({ event, client }) {
  const question = stripBotMention(event.text);
  const threadTs = event.thread_ts || event.ts;

  if (event.thread_ts && db.isThreadMuted(event.thread_ts)) {
    db.unmuteThread(event.thread_ts);
  }

  
  if (event.thread_ts && teachPattern(true).test(question)) {
    if (!isAdmin(event.user)) {
      await client.chat.postEphemeral({ channel: event.channel, user: event.user, text: "that one's helpers-only :nono:" });
      return;
    }

    const strippedCommand = stripTeachCommand(question, true);
    const parsedDirect = learn.parseTeach(strippedCommand);
    if (parsedDirect) {
      const id = learn.teach({ ...parsedDirect, authorId: event.user, threadTs: event.thread_ts, channel: event.channel });
      await client.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        thread_ts: event.thread_ts,
        text: id
          ? `🧚 Memorized for future questions! :yesyes:\n>*Q:* ${parsedDirect.question}\n>*A:* ${parsedDirect.answer}\n\n_#${id} — remove with \`${brand.cmd("forget")} ${id}\`_`
          : "already memorized or couldn't save it",
      });
      return;
    }

    try {
      const parsed = await teachThread.summarizeThread({ client, channel: event.channel, threadTs: event.thread_ts });
      if (!parsed) {
        await client.chat.postEphemeral({
          channel: event.channel,
          user: event.user,
          thread_ts: event.thread_ts,
          text: "couldn't find a clear question and answer in this thread to memorize",
        });
        return;
      }
      const id = learn.teach({ ...parsed, authorId: event.user, threadTs: event.thread_ts, channel: event.channel });
      await client.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        thread_ts: event.thread_ts,
        text: id
          ? `🧚 Memorized this thread for future questions! :yesyes:\n>*Q:* ${parsed.question}\n>*A:* ${parsed.answer}\n\n_#${id} — remove with \`${brand.cmd("forget")} ${id}\`_`
          : "already memorized this thread!",
      });
      return;
    } catch (e) {
      log.error("handlers", `teach thread on mention failed: ${e.message}`);
    }
  }

  const imageFile = findImage(event);
  if (imageFile) {
    if (!db.claimMessage(event.ts, event.channel)) return;
    await handleImage({ event, client, imageFile });
    return;
  }

  if (!db.claimMessage(event.ts, event.channel)) return;

  await respond.respond({
    client,
    channel: event.channel,
    threadTs,
    userId: event.user,
    question,
    messageTs: event.ts,
    mode: respond.ALWAYS,
    seedClient: client,
    addressed: true,
  });
}

async function messageAuthor(client, channel, ts) {
  try {
    const replies = await client.conversations?.replies?.({ channel, ts, limit: 1, inclusive: true });
    if (replies?.messages?.[0]) return replies.messages[0].user || null;
  } catch (e) {
    log.debug("handlers", `replies lookup failed for ${ts}: ${e.message}`);
  }
  try {
    const hist = await client.conversations?.history?.({ channel, latest: ts, limit: 1, inclusive: true });
    return hist?.messages?.[0]?.user || null;
  } catch (e) {
    log.debug("handlers", `history lookup failed for ${ts}: ${e.message}`);
    return null;
  }
}

async function onReactionAdded({ event, client }) {
  
  
  
  
  const channel = event.item?.channel || event.channel;

  if (event.reaction === DELETE_REACTION) {
    try {
      
      
      
      
      
      
      const author = event.item_user || (await messageAuthor(client, channel, event.item.ts));

      if (!author) {
        log.warn("handlers", `delete reaction on ${event.item.ts}: could not tell who wrote it`);
        return;
      }
      if (author !== config.slack.botUserId) return;

      await client.chat.delete({ channel, ts: event.item.ts });
      log.info("handlers", `deleted message ${event.item.ts} via reaction`);
    } catch (e) {
      
      
      log.warn("handlers", `could not delete ${event.item.ts}: ${e.data?.error || e.message}`);
    }
    return;
  }

  const normReaction = (event.reaction || "").toLowerCase();

  if (normReaction === GUIDE_ADVANCE_REACTION) {
    try {
      const guideState = db.getGuideByMessageTs(event.item.ts) || db.getGuide(event.item.ts);
      if (guideState) {
        const nextStepResult = await guides.advanceGuideByReaction({
          messageTs: event.item.ts,
          userId: event.user,
        });
        if (nextStepResult !== null) {
          await respond.postGuideStep({
            client,
            channel,
            threadTs: guideState.thread_ts,
            result: nextStepResult,
          });
          log.info("guides", `advanced guide via reaction in thread ${guideState.thread_ts}`);
          return;
        }
      }
    } catch (e) {
      log.debug("guides", `reaction advance failed: ${e.message}`);
    }
  }

  const vote = UP_REACTIONS.has(normReaction) ? 1 : DOWN_REACTIONS.has(normReaction) ? -1 : 0;
  if (vote !== 0) {
    db.recordFeedback(event.item.ts, event.user, vote);
    log.info("feedback", `vote=${vote} ts=${event.item.ts} user=${event.user}`);
  }
}

async function onReactionRemoved({ event }) {
  const normReaction = (event.reaction || "").toLowerCase();
  if (UP_REACTIONS.has(normReaction) || DOWN_REACTIONS.has(normReaction)) {
    db.removeFeedback(event.item.ts, event.user);
  }
}

module.exports = {
  onMessage,
  onAppMention,
  onReactionAdded,
  onReactionRemoved,
  shouldConsiderThreadReply,
  mentionsPixieByName,
  mentionsPixieDirectly,
  stripBotMention,
  findImage,
  handleImage,
};
