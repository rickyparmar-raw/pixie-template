process.env.PIXIE_DB_PATH = ":memory:";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const tickets = require("./tickets");

before(() => {
  db.close();
  db.open(":memory:");
});

test("escalateTicket creates a ticket in DB and builds card blocks", async () => {
  const posted = [];
  const client = {
    chat: {
      postMessage: async (payload) => {
        posted.push(payload);
        return { ts: "card-ts-123" };
      },
    },
  };

  const activeProg = { id: "sprig", name: "Sprig", posture: "active", helpChannel: "C-sprig" };

  const ticket = await tickets.escalateTicket({
    program: activeProg,
    channel: "C-sprig",
    threadTs: "thread-100",
    requesterId: "U-requester",
    question: "how do i solder the screen",
    client,
  });

  assert.ok(ticket);
  assert.equal(ticket.program_id, "sprig");
  assert.equal(ticket.question, "how do i solder the screen");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].channel, "C-sprig");

  const fetched = db.getTicket(ticket.id);
  assert.equal(fetched.card_ts, "card-ts-123");
});

test("escalateTicket returns existing ticket if thread already escalated", async () => {
  const activeProg = { id: "sprig", name: "Sprig", posture: "active", helpChannel: "C-sprig" };

  const first = await tickets.escalateTicket({
    program: activeProg,
    channel: "C-sprig",
    threadTs: "thread-100",
    requesterId: "U-requester",
    question: "how do i solder the screen",
  });

  const second = await tickets.escalateTicket({
    program: activeProg,
    channel: "C-sprig",
    threadTs: "thread-100",
    requesterId: "U-requester",
    question: "how do i solder the screen",
  });

  assert.equal(first.id, second.id);
});

test("escalateTicket skips passive programs for unprompted tickets", async () => {
  const passiveProg = { id: "pixl", name: "Pixl", posture: "passive", helpChannel: "C-pixl" };

  const result = await tickets.escalateTicket({
    program: passiveProg,
    channel: "C-pixl",
    threadTs: "thread-passive-1",
    requesterId: "U-requester",
    question: "whats pixl",
  });

  assert.equal(result, null);
});

test("buildTicketCardBlocks reflects status changes, unclaiming, and reopening", () => {
  const ticket = { id: 5, program_id: "sprig", requester_id: "U1", channel: "C1", question: "help", status: "open" };
  let blocks = tickets.buildTicketCardBlocks(ticket, { name: "Sprig" });
  assert.ok(blocks.length >= 3);
  assert.equal(blocks[0].text.text, "[Sprig] Ticket #5");

  ticket.status = "claimed";
  ticket.assignee_id = "U-helper";
  blocks = tickets.buildTicketCardBlocks(ticket, { name: "Sprig" });
  assert.match(blocks[2].text.text, /Claimed by <@U-helper>/);
  assert.ok(blocks[3].elements.some((e) => e.action_id === "unclaim_ticket"));

  ticket.status = "resolved";
  blocks = tickets.buildTicketCardBlocks(ticket, { name: "Sprig" });
  assert.ok(blocks[3].elements.some((e) => e.action_id === "reopen_ticket"));
});
