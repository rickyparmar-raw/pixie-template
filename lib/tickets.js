

const db = require("./db");
const reply = require("./reply");
const log = require("./log");
const { config } = require("./config");
const programs = require("./programs");

function buildTicketCardBlocks(ticket, program) {
  const statusEmoji =
    ticket.status === "claimed"
      ? ":eyes:"
      : ticket.status === "resolved"
      ? ":white_check_mark:"
      : ticket.status === "closed"
      ? ":x:"
      : ":sos:";

  const progName = program ? program.name : ticket.program_id || "YSWS";
  const assigneeStr = ticket.assignee_id ? ` • Claimed by <@${ticket.assignee_id}>` : "";
  const statusStr = `*Status*: ${statusEmoji} \`${ticket.status}\`${assigneeStr}`;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `[${progName}] Ticket #${ticket.id}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Question*: ${ticket.question}\n*Requester*: <@${ticket.requester_id}> in <#${ticket.channel}>`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: statusStr },
    },
  ];

  if (ticket.status === "open") {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🙋 Claim Ticket" },
          style: "primary",
          value: String(ticket.id),
          action_id: "claim_ticket",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Resolve" },
          value: String(ticket.id),
          action_id: "resolve_ticket",
        },
      ],
    });
  } else if (ticket.status === "claimed") {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "↩️ Unclaim" },
          value: String(ticket.id),
          action_id: "unclaim_ticket",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Resolve" },
          style: "primary",
          value: String(ticket.id),
          action_id: "resolve_ticket",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Close" },
          value: String(ticket.id),
          action_id: "close_ticket",
        },
      ],
    });
  } else if (ticket.status === "resolved" || ticket.status === "closed") {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Reopen" },
          value: String(ticket.id),
          action_id: "reopen_ticket",
        },
      ],
    });
  }

  return blocks;
}

async function escalateTicket({ program, channel, threadTs, requesterId, question, client }) {
  let ticket = db.getTicketByThreadTs(threadTs);
  if (ticket) return ticket;

  const prog = program || programs.forChannel(channel);
  const programId = prog ? prog.id : "pixl";

  
  if (prog && prog.posture === "passive") {
    log.debug("tickets", `skipping unprompted ticket for passive program ${prog.id}`);
    return null;
  }

  const id = db.createTicket({
    programId,
    channel,
    threadTs,
    requesterId,
    question,
  });

  if (!id) return null;
  ticket = db.getTicket(id);

  const helperChannel = prog.helpChannel || config.slack.helpChannel;
  if (client && helperChannel && client.chat && client.chat.postMessage) {
    try {
      const cardBlocks = reply.plainDashesInBlocks(buildTicketCardBlocks(ticket, prog));
      const res = await client.chat.postMessage({
        channel: helperChannel,
        text: reply.plainDashes(`[Ticket #${ticket.id}] <@${requesterId}> asked: "${question.slice(0, 100)}"`),
        blocks: cardBlocks,
      });
      if (res?.ts) {
        db.updateTicketCardTs(ticket.id, res.ts);
        ticket.card_ts = res.ts;
      }
    } catch (e) {
      log.error("tickets", `failed to post ticket card: ${e.message}`);
    }
  }

  log.info("tickets", `created ticket #${ticket.id} for ${programId} in ${channel}`);
  return ticket;
}

function registerActions(app) {
  app.action("claim_ticket", async ({ action, body, ack, client }) => {
    await ack();
    const ticketId = Number(action.value);
    const userId = body.user?.id;
    if (!ticketId || !userId) return;

    const ok = db.claimTicket(ticketId, userId);
    if (!ok) return;

    const ticket = db.getTicket(ticketId);
    const prog = programs.get(ticket.program_id);
    const helperChannel = prog?.helpChannel || config.slack.helpChannel;

    if (ticket.card_ts && helperChannel) {
      try {
        await client.chat.update({
          channel: helperChannel,
          ts: ticket.card_ts,
          text: `[Ticket #${ticket.id}] Claimed by <@${userId}>`,
          blocks: buildTicketCardBlocks(ticket, prog),
        });
      } catch (e) {
        log.debug("tickets", `failed updating ticket card: ${e.message}`);
      }
    }
  });

  app.action("unclaim_ticket", async ({ action, body, ack, client }) => {
    await ack();
    const ticketId = Number(action.value);
    if (!ticketId) return;

    const ok = db.unclaimTicket(ticketId);
    if (!ok) return;

    const ticket = db.getTicket(ticketId);
    const prog = programs.get(ticket.program_id);
    const helperChannel = prog?.helpChannel || config.slack.helpChannel;

    if (ticket.card_ts && helperChannel) {
      try {
        await client.chat.update({
          channel: helperChannel,
          ts: ticket.card_ts,
          text: `[Ticket #${ticket.id}] Unclaimed`,
          blocks: buildTicketCardBlocks(ticket, prog),
        });
      } catch (e) {
        log.debug("tickets", `failed updating ticket card: ${e.message}`);
      }
    }
  });

  app.action("resolve_ticket", async ({ action, body, ack, client }) => {
    await ack();
    const ticketId = Number(action.value);
    const userId = body.user?.id;
    if (!ticketId) return;

    db.resolveTicket(ticketId, `resolved by <@${userId}>`);
    const ticket = db.getTicket(ticketId);
    const prog = programs.get(ticket.program_id);
    const helperChannel = prog?.helpChannel || config.slack.helpChannel;

    if (ticket.card_ts && helperChannel) {
      try {
        await client.chat.update({
          channel: helperChannel,
          ts: ticket.card_ts,
          text: `[Ticket #${ticket.id}] Resolved`,
          blocks: buildTicketCardBlocks(ticket, prog),
        });
      } catch (e) {
        log.debug("tickets", `failed updating ticket card: ${e.message}`);
      }
    }
  });

  app.action("reopen_ticket", async ({ action, body, ack, client }) => {
    await ack();
    const ticketId = Number(action.value);
    if (!ticketId) return;

    db.reopenTicket(ticketId);
    const ticket = db.getTicket(ticketId);
    const prog = programs.get(ticket.program_id);
    const helperChannel = prog?.helpChannel || config.slack.helpChannel;

    if (ticket.card_ts && helperChannel) {
      try {
        await client.chat.update({
          channel: helperChannel,
          ts: ticket.card_ts,
          text: `[Ticket #${ticket.id}] Reopened`,
          blocks: buildTicketCardBlocks(ticket, prog),
        });
      } catch (e) {
        log.debug("tickets", `failed updating ticket card: ${e.message}`);
      }
    }
  });

  app.action("close_ticket", async ({ action, body, ack, client }) => {
    await ack();
    const ticketId = Number(action.value);
    if (!ticketId) return;

    db.closeTicket(ticketId);
    const ticket = db.getTicket(ticketId);
    const prog = programs.get(ticket.program_id);
    const helperChannel = prog?.helpChannel || config.slack.helpChannel;

    if (ticket.card_ts && helperChannel) {
      try {
        await client.chat.update({
          channel: helperChannel,
          ts: ticket.card_ts,
          text: `[Ticket #${ticket.id}] Closed`,
          blocks: buildTicketCardBlocks(ticket, prog),
        });
      } catch (e) {
        log.debug("tickets", `failed updating ticket card: ${e.message}`);
      }
    }
  });
}

module.exports = {
  buildTicketCardBlocks,
  escalateTicket,
  registerActions,
};
