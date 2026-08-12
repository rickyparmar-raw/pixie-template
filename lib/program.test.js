const { test } = require("node:test");
const assert = require("node:assert/strict");
const program = require("./program");

const NOW = new Date("2026-07-28T12:00:00Z");

test("describeWhen counts whole days in both directions", () => {
  assert.equal(program.describeWhen(new Date("2026-07-28T23:00:00Z"), NOW), "today");
  assert.equal(program.describeWhen(new Date("2026-07-29T01:00:00Z"), NOW), "tomorrow");
  assert.equal(program.describeWhen(new Date("2026-08-01T00:00:00Z"), NOW), "in 4 days");
  assert.equal(program.describeWhen(new Date("2026-07-27T09:00:00Z"), NOW), "yesterday");
  assert.equal(program.describeWhen(new Date("2026-07-20T00:00:00Z"), NOW), "8 days ago");
});

// A deadline earlier the same day is still "today", not "1 day ago" — the
// point is whole-day granularity, not hours.
test("describeWhen ignores time of day", () => {
  assert.equal(program.describeWhen(new Date("2026-07-28T01:00:00Z"), NOW), "today");
});

test("describeEntry marks whether a milestone has passed", () => {
  const upcoming = program.describeEntry({ name: "Submissions close", date: "2026-08-01" }, NOW);
  assert.match(upcoming, /Submissions close/);
  assert.match(upcoming, /in 4 days/);
  assert.match(upcoming, /upcoming/);

  const past = program.describeEntry({ name: "Kickoff", date: "2026-07-01" }, NOW);
  assert.match(past, /already passed/);
});

test("describeEntry includes an optional note and rejects a bad date", () => {
  assert.match(program.describeEntry({ name: "X", date: "2026-08-01", note: "extra detail" }, NOW), /extra detail/);
  assert.equal(program.describeEntry({ name: "X", date: "not a date" }, NOW), null);
});

// The section must never appear empty, and must never invite a guess — pixie
// stating a made-up deadline is worse than saying nothing.
test("corpusSection is empty without usable data", () => {
  assert.equal(program.corpusSection(NOW, null), "");
  assert.equal(program.corpusSection(NOW, { milestones: [] }), "");
  assert.equal(program.corpusSection(NOW, { milestones: [{ name: "X", date: "nope" }] }), "");
  assert.equal(program.corpusSection(NOW, {}), "");
});

test("corpusSection sorts milestones and states today's date", () => {
  const section = program.corpusSection(NOW, {
    milestones: [
      { name: "Submissions close", date: "2026-08-01" },
      { name: "Kickoff", date: "2026-07-01" },
    ],
  });

  assert.match(section, /Today's date is July 28, 2026/);
  assert.ok(section.indexOf("Kickoff") < section.indexOf("Submissions close"), "should be chronological");
  assert.match(section, /Never state a date or a countdown that is not listed here/);
});

test("corpusSection includes the timezone when configured", () => {
  const section = program.corpusSection(NOW, {
    timezone: "America/New_York",
    milestones: [{ name: "Kickoff", date: "2026-07-01" }],
  });
  assert.match(section, /America\/New_York/);
});

// program.json's dates are date-only strings, which parse as UTC midnight.
// A container running with e.g. TZ=America/New_York rendered "2026-08-18" as
// "August 17, 2026" — this reproduces that exact drift and pins the fix.
test("dates render the same regardless of the process timezone", () => {
  const savedTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const section = program.corpusSection(NOW, { milestones: [{ name: "Launch", date: "2026-08-18" }] });
    assert.match(section, /August 18, 2026/);
    assert.doesNotMatch(section, /August 17, 2026/);
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
});

test("load returns null when program.json is missing", () => {
  assert.equal(program.load("/nonexistent/program.json"), null);
});

test("the shipped program.json parses and carries the real release date", () => {
  const data = program.load();
  assert.ok(data, "program.json should exist and parse");

  const section = program.corpusSection(NOW, data);
  assert.match(section, /August 18, 2026/);
  assert.match(section, /in 21 days/);
});

// These are the exact phrasings that fell through to the ungrounded path and
// got pixie corrected in-channel with a wrong date.
test("the release date is reachable by the phrasings people actually used", () => {
  const section = program.corpusSection(NOW, program.load());
  for (const probe of [/When is Pixl launching\?/i, /Is Pixl released yet\?/i, /What is the release date\?/i]) {
    assert.match(section, probe);
  }
});

test("questionPairs answers 'has it happened yet' from both sides of the date", () => {
  const upcoming = program.questionPairs({ name: "Launch", date: "2026-08-18" }, NOW).join("\n");
  assert.match(upcoming, /Not yet — Launch is August 18, 2026/);

  const past = program.questionPairs({ name: "Kickoff", date: "2026-07-01" }, NOW).join("\n");
  assert.match(past, /Yes — Kickoff was July 1, 2026/);
});

test("questionPairs folds in the extra phrasings from the milestone", () => {
  const pairs = program.questionPairs(
    { name: "Launch", date: "2026-08-18", questions: ["When does it drop?"] },
    NOW,
  ).join("\n");
  assert.match(pairs, /When does it drop\?/);
});

/* ------------------------------------------------- deterministic fallback -- */

const RELEASE = { milestones: [{ name: "Pixl official release", date: "2026-08-18" }] };

test("legacy Pixl timeline behavior remains unchanged", () => {
  const result = program.directAnswer("has pixl launched", NOW, RELEASE);
  assert.deepEqual(result, {
    source: "Program timeline",
    answer: "not yet — Pixl official release is August 18, 2026, in 21 days.",
  });
  assert.equal(program.isTimingQuestion("has pixl launched"), true);
});

test("a resolved program name and escaped alias trigger its own timeline answer", () => {
  const metadata = { name: "Shipwrecked!", aliases: ["shipwrecked", "ship+wrecked"] };
  const milestones = [{ name: "Shipwrecked! launch", date: "2026-08-18" }];

  assert.equal(program.isTimingQuestion("has ship+wrecked launched", metadata), true);

  const result = program.directAnswer("has ship+wrecked launched", NOW, milestones, metadata);
  assert.equal(result.source, "Program timeline");
  assert.match(result.answer, /Shipwrecked! launch is August 18, 2026, in 21 days/);
  assert.doesNotMatch(result.answer, /pixl/i);
  assert.doesNotMatch(program.corpusSection(NOW, milestones, metadata), /pixl/i);
});

test("metadata-driven timeline helpers safely decline missing or malformed milestones", () => {
  const metadata = { name: "Shipwrecked!", aliases: ["ship+wrecked"] };

  assert.equal(program.corpusSection(NOW, null, metadata), "");
  assert.equal(program.directAnswer("has ship+wrecked launched", NOW, null, metadata), null);
  assert.equal(program.directAnswer("has ship+wrecked launched", NOW, [{ name: "Launch", date: "nope" }], metadata), null);
  assert.equal(program.isTimingQuestion("has ship+wrecked launched", { name: null, aliases: [null, {}] }), false);
});

test("isTimingQuestion catches the phrasings the model kept declining", () => {
  for (const q of ["has pixl launched", "is pixl out yet", "is pixl live", "when does pixl drop", "whats the deadline"]) {
    assert.equal(program.isTimingQuestion(q), true, q);
  }
});

test("isTimingQuestion ignores non-timing questions", () => {
  for (const q of ["how do i join", "whats the prize", "who made you", "pixie whats up"]) {
    assert.equal(program.isTimingQuestion(q), false, q);
  }
});

test("directAnswer resolves a single milestone without the model", () => {
  const result = program.directAnswer("has pixl launched", NOW, RELEASE);
  assert.equal(result.source, "Program timeline");
  assert.match(result.answer, /not yet/);
  assert.match(result.answer, /August 18, 2026/);
  assert.match(result.answer, /in 21 days/);
});

test("directAnswer switches to past tense once the date has passed", () => {
  const after = new Date("2026-09-01T12:00:00Z");
  assert.match(program.directAnswer("has pixl launched", after, RELEASE).answer, /was August 18, 2026/);
});

test("directAnswer declines non-timing questions and empty data", () => {
  assert.equal(program.directAnswer("how do i join", NOW, RELEASE), null);
  assert.equal(program.directAnswer("has pixl launched", NOW, { milestones: [] }), null);
  assert.equal(program.directAnswer("has pixl launched", NOW, null), null);
});

// With several milestones an unqualified "when is the deadline" is ambiguous —
// better to let the normal path handle it than to answer about the wrong one.
test("directAnswer needs the question to name a milestone when there are several", () => {
  const many = {
    milestones: [
      { name: "Pixl official release", date: "2026-08-18" },
      { name: "Chapter two", date: "2026-09-30" },
    ],
  };
  assert.equal(program.directAnswer("when is the deadline", NOW, many), null);
  assert.match(program.directAnswer("when does chapter two start", NOW, many).answer, /September 30/);
});

// A bare /live/ would answer "where do you live" with a release date.
test("isTimingQuestion does not treat every use of 'live' as a timing question", () => {
  assert.equal(program.isTimingQuestion("where do you live"), false);
  assert.equal(program.isTimingQuestion("i live in canada"), false);
  assert.equal(program.isTimingQuestion("is pixl live"), true);
  assert.equal(program.isTimingQuestion("has the game gone live"), true);
});

// Live bug: "how do i start pcb, what is pcb and schematics" got answered
// with the launch countdown instead of the actual question — a bare
// \bstarts?\b matched "start" in "how do i start X" with nothing to tell it
// that's not a question about whether the program itself has started.
test("isTimingQuestion does not treat 'start'/'end'/'close' as timing words on their own", () => {
  assert.equal(program.isTimingQuestion("how do i start pcb, what is pcb and schematics"), false);
  assert.equal(program.isTimingQuestion("how do i start building a macropad"), false);
  assert.equal(program.isTimingQuestion("how do i end this function early"), false);
  assert.equal(program.isTimingQuestion("how do i close this file in vim"), false);
});

test("isTimingQuestion still catches 'start'/'end' when they're actually about the program", () => {
  assert.equal(program.isTimingQuestion("has pixl started yet"), true);
  assert.equal(program.isTimingQuestion("does it start today"), true);
  assert.equal(program.isTimingQuestion("when does chapter two start"), true);
});

test("directAnswer declines the exact live-bug question instead of answering with the countdown", () => {
  assert.equal(program.directAnswer("how do i start pcb, what is pcb and schematics", NOW, RELEASE), null);
});

// programTerms has the same bare-word risk as TIMING_PATTERN, and for the
// single-milestone branch specifically — a question that doesn't name the
// milestone falls through to this check alone.
test("directAnswer's single-milestone fallback needs program-referring context for 'start', not a bare mention", () => {
  assert.equal(program.directAnswer("how do i start my own project", NOW, RELEASE), null);
  assert.match(program.directAnswer("has it started yet", NOW, RELEASE).answer, /August 18, 2026/);
});

test("directAnswer does not intercept hackatime hours discrepancy queries", () => {
  assert.equal(program.directAnswer("Pixl website shows 5.1h when 5.6 on hackatime?", NOW, RELEASE), null);
  assert.equal(program.isTimingQuestion("Pixl website shows 5.1h when 5.6 on hackatime?"), false);
  assert.equal(program.isTimingQuestion("my hackatime is not syncing"), false);
});
