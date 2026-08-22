// Verifies the diff function in scripts/migrate-railway.js.
//
// Run with: node scripts/test-diff.mjs
// (No network or environment needed — pure logic.)

const REQUIRED = ["SLACK_BOT_TOKEN","SLACK_APP_TOKEN","SLACK_HELP_CHANNEL","SLACK_FAQ_CHANNELS","HCAI_API_KEY"];
const OPTIONAL = ["PIXIE_BOT_NAME","PIXIE_BOT_SLUG","PIXIE_PROGRAMS_JSON","PIXIE_DB_PATH","PIXIE_FEEDBACK_REACTIONS","HCAI_MODEL","HCAI_PING_MODEL","HCAI_HELP_MODEL","HCAI_INTENT_MODEL","HCAI_VISION_MODEL"];

function redactedForLog(value) {
  const s = String(value);
  if (s.length === 0) return "<empty>";
  if (s.length <= 8) return `${s.length} chars: ${"*".repeat(s.length)}`;
  return `${s.length} chars: ${s.slice(0, 3)}…${"*".repeat(Math.max(0, s.length - 7))}`;
}

function diff(current, desired) {
  const known = new Set([...REQUIRED, ...OPTIONAL]);

  const out = { missing: [], mismatch: [], unexpected: [], extra: [], wouldSet: [] };
  const seen = new Set();

  const allKeys = new Set([...REQUIRED, ...OPTIONAL, ...Object.keys(current), ...Object.keys(desired)]);

  for (const key of allKeys) {
    if (seen.has(key)) continue;
    seen.add(key);

    const have = current[key];
    const want = desired[key];
    const wantIsEmpty = want === undefined || want === null || want === "";
    const haveIsEmpty = have === undefined || have === null || have === "";

    if (wantIsEmpty) {
      if (REQUIRED.includes(key) && !haveIsEmpty) out.extra.push(key);
      else if (REQUIRED.includes(key) && haveIsEmpty) out.missing.push(key);
      else if (!haveIsEmpty) out.extra.push(key);
      continue;
    }
    if (haveIsEmpty) {
      if (REQUIRED.includes(key)) out.missing.push(key);
      else out.wouldSet.push(key);
      continue;
    }
    if (String(have) !== String(want)) out.mismatch.push({ key, have: redactedForLog(have), want: redactedForLog(want) });
  }

  for (const key of Object.keys(desired)) {
    if (!known.has(key)) out.unexpected.push(key);
  }
  return out;
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  ok", name); }
  else { fail++; console.error("  FAIL", name, "\n    got:", got, "\n    want:", want); }
}

eq("identical is empty",
  diff(
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x" },
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x" },
  ),
  { missing: [], mismatch: [], unexpected: [], extra: [], wouldSet: [] });

eq("required key missing in FILE is reported",
  diff(
    { SLACK_BOT_TOKEN: "x" },
    { SLACK_BOT_TOKEN: "x" },
  ).missing,
  ["SLACK_APP_TOKEN","SLACK_HELP_CHANNEL","SLACK_FAQ_CHANNELS","HCAI_API_KEY"]);

eq("mismatch detected",
  diff(
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "OLD" },
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "NEW" },
  ).mismatch.map((m) => m.key),
  ["HCAI_API_KEY"]);

eq("new optional becomes wouldSet",
  diff(
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x" },
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x", PIXIE_DB_PATH: "/data/pixie.db" },
  ).wouldSet,
  ["PIXIE_DB_PATH"]);

eq("set on current but blank in file -> extra",
  diff(
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x", PIXIE_FEEDBACK_REACTIONS: "yesyes" },
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x" },
  ).extra,
  ["PIXIE_FEEDBACK_REACTIONS"]);

eq("typo flagged as unexpected",
  diff(
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x" },
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x", PIXIE_BUG: "typo" },
  ).unexpected,
  ["PIXIE_BUG"]);

eq("a second HCAI key is rejected",
  diff(
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x" },
    { SLACK_BOT_TOKEN: "x", SLACK_APP_TOKEN: "x", SLACK_HELP_CHANNEL: "x", SLACK_FAQ_CHANNELS: "x", HCAI_API_KEY: "x", HCAI_API_KEY_2: "y" },
  ).unexpected,
  ["HCAI_API_KEY_2"]);

console.log("\n" + (fail === 0 ? "all pass" : `${fail} fail`));
process.exit(fail > 0 ? 1 : 0);
