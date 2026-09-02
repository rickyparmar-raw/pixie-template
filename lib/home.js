

const knowledge = require("./knowledge");
const reply = require("./reply");
const guides = require("./guides");
const learn = require("./learn");
const db = require("./db");
const cache = require("./cache");
const programs = require("./programs");
const log = require("./log");
const brand = require("./brand");
const { isAdmin } = require("./config");
const { relativeTime, coverageStats, statsText } = require("./stats");

const HOME_REVIEW_LIMIT = 8;
const HOME_LEARNED_LIMIT = 3;

const APPROVE_ACTION = "learn_approve";
const DROP_ACTION = "learn_drop";

const HEALTHY_COVERAGE = 50;

function coverageBlocks() {
  const { docs, asked, rate } = coverageStats();
  if (asked === 0) return [];

  const verdict =
    rate >= HEALTHY_COVERAGE
      ? "the docs are carrying most questions."
      : "most answers came from general knowledge, not the docs — the gaps below are what to write next.";

  return [
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*docs coverage — ${rate}%* _(last 7d)_\n${docs} of ${asked} questions answered from the docs. ${verdict}`,
      },
    },
  ];
}

function learnedBlocks() {
  const { known, cacheHits, instant } = coverageStats();
  if (known === 0) return [];

  const top = cache.topCached(HOME_LEARNED_LIMIT).filter((row) => row.ask_count > 1);
  const lines = [`*answers known cold — ${known}*`, `${cacheHits} replies (${instant}%) needed no thinking at all.`];

  if (top.length > 0) {
    lines.push("", "asked most:");
    for (const row of top) lines.push(`• _${row.question}_ — ${row.ask_count}x`);
  }

  return [{ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }];
}

function reviewBlocks(userId) {
  if (!isAdmin(userId)) return [];

  const rows = learn.pending(HOME_REVIEW_LIMIT);
  if (rows.length === 0) {
    return [
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: "*waiting for review*\n_nothing queued_ :yay:" } },
    ];
  }

  const blocks = [
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*waiting for review* — ${rows.length} candidate answer(s)` } },
  ];

  for (const row of rows) {
    
    
    
    
    const attribution = row.author_id ? `from <@${row.author_id}>` : "drafted from repeated help-channel questions";
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*asked:* _${row.question.slice(0, 150)}_\n>${row.answer.slice(0, 300).replace(/\n/g, "\n>")}\n_${attribution}, ${relativeTime(row.created_at)}_`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Approve", emoji: true },
            action_id: `${APPROVE_ACTION}_${row.id}`,
            value: String(row.id),
          },
          {
            type: "button",
            style: "danger",
            text: { type: "plain_text", text: "Drop", emoji: true },
            action_id: `${DROP_ACTION}_${row.id}`,
            value: String(row.id),
          },
        ],
      },
    );
  }

  return blocks;
}

function programSummary() {
  try {
    const named = programs
      .all()
      .filter((p) => p.id !== "ysws-global")
      .map((p) => p.name)
      .filter(Boolean);
    if (named.length === 0) return "Hack Club YSWS programs";
    if (named.length === 1) return named[0];
    return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  } catch (e) {
    return "Hack Club YSWS programs";
  }
}

function homeBlocks(userId) {
  const sources = (() => {
    try {
      return knowledge.loadSources();
    } catch {
      return [];
    }
  })();

  const gaps = db.topGaps(5);
  const topics = db.getTopics(userId).slice(0, 5);

  const blocks = [
    { type: "header", text: { type: "plain_text", text: brand.name(), emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `i answer questions for ${programSummary()} from their docs. ping me anywhere, DM me here, or use \`${brand.cmd()} <question>\` for a private answer.`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*what i know*\n${sources.map((s) => `• ${s.name}`).join("\n") || "_no sources loaded_"}\n\n_refreshed ${relativeTime(knowledge.lastBuiltAt?.getTime())}_`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*what i can walk you through*\n${guides.availableFor(programs.all()[0])
          .map(([, g]) => `• ${g.name}`)
          .join("\n")}`,
      },
    },
    ...coverageBlocks(),
    ...learnedBlocks(),
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*stats*\n${statsText().split("\n").slice(1).join("\n")}` } },
  ];

  if (topics.length > 0) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*you've asked about*\n${topics.map((t) => `• ${t.topic}`).join("\n")}` },
      },
    );
  }

  if (gaps.length > 0) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*top gaps in the docs*\n${gaps.map((g) => `• ${g.ask_count}× ${g.question.slice(0, 80)}`).join("\n")}`,
        },
      },
    );
  }

  blocks.push(...reviewBlocks(userId));

  
  
  return reply.plainDashesInBlocks(blocks);
}

function reviewAction(apply, verb) {
  return async ({ ack, body, action, client }) => {
    await ack();

    const userId = body?.user?.id;
    
    
    if (!isAdmin(userId)) return;

    const id = Number(action?.value);
    if (Number.isInteger(id) && id > 0) {
      log.info("learn", `${verb} #${id} from app home by ${userId}`);
      apply(id);

      
      
      if (verb === "dropped") {
        try {
          const row = db.getLearnedFactById(id);
          if (row && row.question) {
            db.recordGapRejection(row.question);
            log.info("gaps", `rejected as gap, will hide from topGaps: "${row.question.slice(0, 80)}"`);
          }
        } catch (e) {
          log.debug("gaps", `failed to record gap rejection: ${e.message}`);
        }
      }
    }

    try {
      await client.views.publish({ user_id: userId, view: { type: "home", blocks: homeBlocks(userId) } });
    } catch (e) {
      log.error("home", "republish after review failed:", e.message);
    }
  };
}

async function onAppHomeOpened({ event, client }) {
  if (event.tab !== "home") return;
  try {
    await client.views.publish({
      user_id: event.user,
      view: { type: "home", blocks: homeBlocks(event.user) },
    });
  } catch (e) {
    log.error("home", "publish failed:", e.message);
  }
}

function register(app) {
  app.event("app_home_opened", onAppHomeOpened);

  
  
  
  
  app.action(new RegExp(`^${APPROVE_ACTION}_`), reviewAction(learn.approve, "approved"));
  app.action(new RegExp(`^${DROP_ACTION}_`), reviewAction(learn.forget, "dropped"));
}

module.exports = {
  register,
  homeBlocks,
  reviewBlocks,
  coverageBlocks,
  reviewAction,
  onAppHomeOpened,
  HOME_REVIEW_LIMIT,
  HOME_LEARNED_LIMIT,
  HEALTHY_COVERAGE,
};
