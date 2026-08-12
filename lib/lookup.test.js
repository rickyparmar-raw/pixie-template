const { test } = require("node:test");
const assert = require("node:assert/strict");
const db = require("./db");
const lookup = require("./lookup");
const programs = require("./programs");

db.open(":memory:");

/* ---------------------------------------------------------- dateFallback -- */
// The timeline's own answer to "is it out yet", used when the docs come up
// empty. It was calling directAnswer(question, programId) — and that second
// parameter is the current date. Every timing question threw
// `now.getTime is not a function`, respond() caught it, and the person got the
// generic error reply instead of the date. Nothing failed loudly enough to
// notice, which is why these tests exist.

const PROG = {
  id: "t-timeline",
  name: "Timeline Test",
  milestones: [{ name: "Timeline Test launch", date: "2020-01-15" }],
};

test("dateFallback answers a timing question from the program's milestones", () => {
  const result = lookup.dateFallback("is timeline test out yet", "", PROG);
  assert.equal(result?.source, "Program timeline");
  assert.match(result.answer, /Timeline Test launch/);
  assert.match(result.answer, /January 15, 2020/);
});

test("dateFallback accepts a bare program id as well as a record", () => {
  programs.saveProgram(PROG);
  programs.invalidate();
  const result = lookup.dateFallback("has timeline test launched", "", "t-timeline");
  assert.equal(result?.source, "Program timeline");
  assert.match(result.answer, /Timeline Test launch/);
});

test("dateFallback returns null for a question that isn't about timing", () => {
  assert.equal(lookup.dateFallback("how do i center a div", "", PROG), null);
});

test("dateFallback falls back to the shared timeline with no program", () => {
  // Whatever the shared milestones say, the call must not throw — that throw
  // is the bug this covers.
  assert.doesNotThrow(() => lookup.dateFallback("when does it drop", "", null));
});

/* ------------------------------------------------------------------ idOf -- */
// Callers hand over a record, an id, or nothing. The cache and corpus key off
// the id; the prompt needs the record.

test("idOf accepts a record, an id, or nothing", () => {
  assert.equal(lookup.idOf({ id: "pixl", name: "Pixl" }), "pixl");
  assert.equal(lookup.idOf("pixl"), "pixl");
  assert.equal(lookup.idOf(null), null);
  assert.equal(lookup.idOf({ name: "no id" }), null);
});

/* --------------------------------------------------------- retrievalQuery -- */

test("retrievalQuery augments follow-up questions with program name and thread context", () => {
  const context = "User: what is pixl and how does it work\nAssistant: pixl is a hack club ysws program!";
  const augmented = lookup.retrievalQuery("how does it work", context, { id: "pixl", name: "Pixl" });
  assert.match(augmented, /Pixl/);
  assert.match(augmented, /what is pixl and how does it work/);
});

test("retrievalQuery leaves standalone non-follow-up questions intact", () => {
  const standalone = "how many pixels for a ps5 controller in the shop";
  const result = lookup.retrievalQuery(standalone, "", { id: "pixl", name: "Pixl" });
  assert.equal(result, standalone);
});
