// Program timeline. "When does X close" is the most-asked category for a YSWS
// program, and a date written into a doc goes stale silently — it still reads
// as correct long after it's passed. These are computed on every corpus
// refresh instead, so pixie says "in 4 days" and says "closed" once it has.
const fs = require("fs");
const path = require("path");
const log = require("./log");

const PROGRAM_PATH = path.join(__dirname, "..", "program.json");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function load(filePath = PROGRAM_PATH) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") log.warn("program", `could not read program.json: ${e.message}`);
    return null;
  }
}

// UTC explicitly: entry.date strings parse as UTC midnight, so rendering in the
// process's local zone can drift a full calendar day off — a Railway container
// with TZ=America/New_York rendered "2026-08-18" as "August 17, 2026".
function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Whole-day granularity: "in 1 day" reads better than "in 23 hours" for a
// deadline, and avoids implying a precision the dates don't have.
function describeWhen(target, now) {
  const startOfDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOfDay(target) - startOfDay(now)) / MS_PER_DAY);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

function describeEntry(entry, now) {
  const date = new Date(entry.date);
  if (Number.isNaN(date.getTime())) return null;

  const when = describeWhen(date, now);
  const passed = date.getTime() < now.getTime();
  const status = passed ? "already passed" : "upcoming";

  const parts = [`${entry.name}: ${formatDate(date)} — ${when} (${status})`];
  if (entry.note) parts.push(`  ${entry.note}`);
  return parts.join("\n");
}

// The rest of the corpus is Q/A pairs, and the grounded prompt matches that
// shape far more reliably than prose. Without this, "is pixl released yet?"
// declined even though the date was right there in the timeline — the model
// didn't recognise it as a question the section covered.
function questionPairs(entry, now) {
  const date = new Date(entry.date);
  if (Number.isNaN(date.getTime())) return [];

  const passed = date.getTime() < now.getTime();
  const when = describeWhen(date, now);
  const pretty = formatDate(date);
  const extra = Array.isArray(entry.questions) ? entry.questions : [];

  const pairs = [
    [
      [`When is ${entry.name}?`, `What date is ${entry.name}?`, ...extra].join(" / "),
      `${pretty} — ${when}.`,
    ],
  ];

  // "Has it happened yet" is a different question from "when is it", and gets
  // asked at least as often in the run-up to a launch.
  pairs.push([
    `Has ${entry.name} happened yet? / Is it out yet? / Is ${entry.name} done?`,
    passed
      ? `Yes — ${entry.name} was ${pretty}, ${when}.`
      : `Not yet — ${entry.name} is ${pretty}, ${when}.`,
  ]);

  return pairs.map(([q, a]) => `Q: ${q}\nA: ${a}`);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNamesRegexPattern(metadata) {
  if (metadata === null || metadata === undefined) {
    return "pixl";
  }
  const names = [];
  if (typeof metadata === "object") {
    if (typeof metadata.name === "string" && metadata.name.trim()) {
      names.push(metadata.name.trim());
    }
    if (Array.isArray(metadata.aliases)) {
      for (const a of metadata.aliases) {
        if (typeof a === "string" && a.trim()) {
          names.push(a.trim());
        }
      }
    }
  }
  if (names.length === 0) {
    return null;
  }
  return names.map(escapeRegex).join("|");
}

function buildTimingPattern(metadata) {
  const namesPattern = buildNamesRegexPattern(metadata);
  if (namesPattern === null) return null;
  return new RegExp(
    `\\b(?:when (?:is|are|does|did|will|do|was|drop)|what date|how long (?:until|left|till)|how many days (?:until|left|till)|release date|launch date|is it out|out yet|come out|coming out|drop(?:s|ping|ped)?|deadline|due date)\\b|` +
    `\\b(?:is|are|has|have)\\b[^?.!]{0,30}\\blive\\b|` +
    `\\b(?:is|are|has|have|does|did|will)\\b[^?.!]{0,20}\\b(?:${namesPattern}|it|this|program|chapter)\\b[^?.!]{0,20}\\b(?:start(?:s|ed|ing)?|end(?:s|ed|ing)?|clos(?:es|ed|ing)?|launch(?:ed|ing)?|release[ds]?)\\b`,
    "i",
  );
}

function isTimingQuestion(text, metadata = null) {
  const t = String(text || "");
  if (/\b(?:hackatime|wakatime|hours?|storage|tracking|tracked|shows|sync|discrepancy|drift|error|why|how do i|how to|npm|code)\b/i.test(t) && !/\b(?:deadline|release date|launch date)\b/i.test(t)) {
    return false;
  }
  const pattern = buildTimingPattern(metadata);
  if (!pattern) return false;
  return pattern.test(t);
}

function extractMilestones(dataOrMilestones) {
  if (!dataOrMilestones) return [];
  if (Array.isArray(dataOrMilestones)) return dataOrMilestones;
  if (Array.isArray(dataOrMilestones.milestones)) return dataOrMilestones.milestones;
  return [];
}

// Returns "" when there's no milestones or no usable dates, so the section
// is omitted entirely rather than inviting the model to guess.
function corpusSection(now = new Date(), dataOrMilestones = load(), metadata = null) {
  const entries = extractMilestones(dataOrMilestones);
  if (entries.length === 0) return "";

  const sorted = entries.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  const lines = sorted.map((entry) => describeEntry(entry, now)).filter(Boolean);
  if (lines.length === 0) return "";

  const pairs = sorted.flatMap((entry) => questionPairs(entry, now));

  const header = [
    `Today's date is ${formatDate(now)}.`,
    "These are the real program dates. Use them for any question about deadlines, timing, or how long is left.",
    "Never state a date or a countdown that is not listed here.",
    "",
  ];

  const tz = dataOrMilestones && !Array.isArray(dataOrMilestones) ? dataOrMilestones.timezone : null;
  const footer = tz ? [`All times are ${tz}.`] : [];

  return [...header, ...lines, "", ...pairs, "", ...footer].join("\n");
}

// Returns { source, answer } shaped like a grounded answer, or null when this
// isn't a timing question, there are no dates, or which milestone is meant is
// ambiguous — in which case the normal fallback path takes over.
function directAnswer(question, now = new Date(), dataOrMilestones = load(), metadata = null) {
  if (!isTimingQuestion(question, metadata)) return null;

  const milestones = extractMilestones(dataOrMilestones);
  const entries = milestones.filter(
    (e) => e && e.date && !Number.isNaN(new Date(e.date).getTime()),
  );
  if (entries.length === 0) return null;

  const asked = (question || "").toLowerCase();

  // Exclude non-program timing queries like "how long does review take", "how long is a quest", etc.
  if (/how long (?:does|do|is|will) (?:review|quest|sidequest|building|approval|processing|take)/i.test(asked)) {
    return null;
  }

  // Words that are program names or generic should not count as milestone matchers
  const ignoredWords = new Set(["pixl", "ysws", "official", "program", "the", "hack", "club"]);
  const named = entries.filter((e) =>
    e.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length > 3 && !ignoredWords.has(word) && asked.includes(word)),
  );

  const namesPattern = buildNamesRegexPattern(metadata);
  const programTerms = new RegExp(
    `\\b(?:release|launch|out|deadline|finish|due|drop|schedule)\\b|\\b(?:is|are|has|have|does|did|will)\\b[^?.!]{0,20}\\b(?:${namesPattern}|it|this|program|chapter)\\b[^?.!]{0,20}\\b(?:start(?:s|ed|ing)?|end(?:s|ed|ing)?|launch(?:ed|ing)?|release[ds]?)\\b`,
    "i",
  );
  const entry = named.length === 1 ? named[0] : (entries.length === 1 && programTerms.test(asked) ? entries[0] : null);
  if (!entry) return null;

  const date = new Date(entry.date);
  const passed = date.getTime() < now.getTime();
  const when = describeWhen(date, now);

  return {
    source: "Program timeline",
    answer: passed
      ? `${entry.name} was ${formatDate(date)} — ${when}.`
      : `not yet — ${entry.name} is ${formatDate(date)}, ${when}.`,
  };
}

module.exports = {
  load,
  corpusSection,
  describeWhen,
  describeEntry,
  questionPairs,
  directAnswer,
  isTimingQuestion,
  PROGRAM_PATH,
};
