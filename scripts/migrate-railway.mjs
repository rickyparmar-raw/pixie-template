#!/usr/bin/env bun
//
// Migrate a pixie engine deployment to a new Railway account/project.
//
// Three modes:
//
//   --dump-expected  Print a JSON skeleton of every var the engine reads, so you
//                    can fill it in with real values and never miss one.
//   --check FILE     Read the new env from FILE and diff against the new
//                    Railway project's existing variables. Aborts on any
//                    unexpected key, missing required key, or obvious typo.
//                    Read-only — never writes.
//   --write FILE     Like --check, but writes the new env via the Railway
//                    public GraphQL API. Refuses to run if --check wouldn't
//                    pass.
//
// Setup:
//
//   1. Generate a token at https://railway.com/account/tokens (account-scoped).
//   2. Set RAILWAY_TOKEN in your shell.
//   3. Set RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID (and the service id
//      for the engine service, RAILWAY_SERVICE_ID).
//   4. Run --dump-expected to get a current-env.json skeleton, fill it in,
//      then --check, then --write.
//
// Why a script and not a one-line curl: because the failure modes the script
// catches are the ones that look fine until 2am.
//
// ESM (.mjs) because the engine's other scripts/ files use require(), and
// scripts/package.json would otherwise flip the whole directory to ESM and
// break them.

import { writeFileSync, readFileSync, existsSync } from "node:fs";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

const REQUIRED_KEYS = [
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_HELP_CHANNEL",
  "SLACK_FAQ_CHANNELS",
  "HCAI_API_KEY",
];

const OPTIONAL_KEYS = [
  "PIXIE_BOT_NAME",
  "PIXIE_BOT_SLUG",
  "PIXIE_PROGRAMS_JSON",
  "HCAI_MODEL",
  "HCAI_PING_MODEL",
  "HCAI_HELP_MODEL",
  "HCAI_INTENT_MODEL",
  "HCAI_VISION_MODEL",
  "PIXIE_ADMIN_USER_IDS",
  "PIXIE_FEEDBACK_REACTIONS",
  "PIXIE_ESCALATE_REACTION",
  "PIXIE_REPORT_CHANNEL",
  "REFRESH_INTERVAL_MIN",
  "FIRECRAWL_API_KEY",
  "PIXIE_IDENTITY_OVERRIDE",
  "PIXIE_DB_PATH",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "PIXIE_WEB_URL",
  "PIXIE_WEB_PORT",
  "PIXIE_SESSION_SECRET",
];

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`error: ${name} is not set in the environment`);
    process.exit(2);
  }
  return v;
}

async function callRailway(query, variables = {}) {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("RAILWAY_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`railway api: ${body.errors[0].message}`);
  }
  return body.data;
}

async function fetchCurrentVars() {
  const data = await callRailway(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
       variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
     }`,
    {
      projectId: required("RAILWAY_PROJECT_ID"),
      environmentId: required("RAILWAY_ENVIRONMENT_ID"),
      serviceId: required("RAILWAY_SERVICE_ID"),
    },
  );
  return data.variables || {};
}

function dumpExpected() {
  const skeleton = {};
  for (const key of [...REQUIRED_KEYS, ...OPTIONAL_KEYS]) {
    skeleton[key] = "";
  }
  console.log(JSON.stringify(skeleton, null, 2));
  console.error("");
  console.error("fill in the values, save to current-env.json, then run --check FILE");
}

function loadFile(path) {
  if (!existsSync(path)) {
    console.error(`error: file not found: ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`error: ${path} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
}

function diff(current, desired) {
  const known = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

  const out = { missing: [], mismatch: [], unexpected: [], extra: [], wouldSet: [] };
  const seen = new Set();

  // The full set of keys to consider: every known key, every key the FILE
  // provides (even if unknown to us), and every key the current project
  // already has. Required keys are always considered even when both sides
  // are empty, because a missing required key is what the user actually
  // needs to see — "you forgot to fill this in."
  const allKeys = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS, ...Object.keys(current), ...Object.keys(desired)]);

  for (const key of allKeys) {
    if (seen.has(key)) continue;
    seen.add(key);

    const have = current[key];
    const want = desired[key];
    const wantIsEmpty = want === undefined || want === null || want === "";
    const haveIsEmpty = have === undefined || have === null || have === "";

    if (wantIsEmpty) {
      // Required keys are special: a missing required is a hard error
      // regardless of whether anything was set before. Catch the case
      // where the FILE simply hasn't filled it in.
      if (REQUIRED_KEYS.includes(key) && !haveIsEmpty) {
        // have set, FILE empty — counts as extra on the project, the user
        // should know not to lose it
        out.extra.push(key);
      } else if (REQUIRED_KEYS.includes(key) && haveIsEmpty) {
        out.missing.push(key);
      } else if (!haveIsEmpty) {
        out.extra.push(key);
      }
      continue;
    }
    if (haveIsEmpty) {
      if (REQUIRED_KEYS.includes(key)) out.missing.push(key);
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

// Slacks the diff output a bit — doesn't print the actual token, just its shape
// and length — so a copy-pasted run-log is less of a leak.
function redactedForLog(value) {
  const s = String(value);
  if (s.length === 0) return "<empty>";
  if (s.length <= 8) return `${s.length} chars: ${"*".repeat(s.length)}`;
  return `${s.length} chars: ${s.slice(0, 3)}…${"*".repeat(Math.max(0, s.length - 7))}`;
}

function printDiff(diff) {
  const rows = [];
  for (const key of diff.missing) rows.push([key, "MISSING", "", "—", "required, will be set"]);
  for (const m of diff.mismatch) rows.push([m.key, "MISMATCH", m.have, m.want, "will be overwritten"]);
  for (const key of diff.wouldSet) rows.push([key, "SET", "—", redactedForLog("(set)"), "currently unset, will be set"]);
  for (const key of diff.extra) rows.push([key, "REMOVE?", "set on Railway", "—", "unset in FILE; leave or remove"]);
  for (const key of diff.unexpected) rows.push([key, "UNEXPECTED", redactedForLog("(in FILE)"), "—", "not in the engine's known list — typo?"]);

  if (rows.length === 0) {
    console.log("diff: every known key matches. nothing to do.");
    return;
  }

  console.log("key                                    status       current           file              action");
  console.log("-".repeat(110));
  for (const [k, s, c, w, a] of rows) {
    console.log(`${k.padEnd(40)} ${s.padEnd(13)} ${c.padEnd(18)} ${w.padEnd(18)} ${a}`);
  }

  if (diff.missing.length > 0) {
    console.error("");
    console.error("FAIL: required keys are missing. fill them in before continuing.");
    process.exit(1);
  }
  if (diff.unexpected.length > 0) {
    console.error("");
    console.error("FAIL: unexpected keys in the FILE. remove them or confirm they belong in the engine.");
    process.exit(1);
  }
  if (diff.mismatch.length > 0) {
    console.error("");
    console.error("note: keys above marked MISMATCH will be overwritten on --write.");
  }
}

async function writeVars(desired) {
  // Railway's variableCollectionUpsert takes a single mutation; build the
  // shape it expects. Only the keys that actually need writing (non-empty in
  // the FILE and either missing or different on the project) so we don't
  // churn unrelated vars.
  const current = await fetchCurrentVars();
  const d = diff(current, desired);
  const wouldSet = new Set([...d.missing.map((k) => k), ...d.wouldSet, ...d.mismatch.map((m) => m.key)]);
  const input = {};
  for (const key of Object.keys(desired)) {
    if (wouldSet.has(key) && String(desired[key] ?? "") !== "") {
      input[key] = String(desired[key]);
    }
  }
  if (Object.keys(input).length === 0) {
    console.log("write: nothing to do — every var already matches.");
    return;
  }

  console.error("");
  console.error(`writing ${Object.keys(input).length} var(s) to railway…`);
  for (const key of Object.keys(input)) {
    console.error(`  ${key}`);
  }

  await callRailway(
    `mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $input: VariableCollectionUpsertInput!) {
       variableCollectionUpsert(input: $input)
     }`,
    {
      projectId: required("RAILWAY_PROJECT_ID"),
      environmentId: required("RAILWAY_ENVIRONMENT_ID"),
      serviceId: required("RAILWAY_SERVICE_ID"),
      input: {
        projectId: required("RAILWAY_PROJECT_ID"),
        environmentId: required("RAILWAY_ENVIRONMENT_ID"),
        serviceId: required("RAILWAY_SERVICE_ID"),
        variables: input,
        // skipDeploys lets the wizard's cron (and any in-flight deploys) finish
        // before the next restart, rather than triggering a partial deploy.
        skipDeploys: true,
      },
    },
  );

  console.error("");
  console.error("ok. vars written. trigger a deploy manually when you're ready.");
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "--dump-expected") return dumpExpected();

  if (cmd === "--check" || cmd === "--write") {
    const file = args[1];
    if (!file) {
      console.error(`usage: bun run migrate-railway.js ${cmd} FILE`);
      process.exit(2);
    }
    const desired = loadFile(file);
    const current = await fetchCurrentVars();
    const d = diff(current, desired);
    printDiff(d);
    if (cmd === "--write") {
      // A second gate: --check would have exited 1 already on missing or
      // unexpected keys. If we got here, every required key is present and
      // every FILE key is a known one, so the write is safe.
      await writeVars(desired);
    }
    return;
  }

  console.error("pixie railway migration script");
  console.error("");
  console.error("modes:");
  console.error("  --dump-expected       print a JSON skeleton of all env vars the engine reads");
  console.error("  --check FILE          diff FILE against the new project's variables (read-only)");
  console.error("  --write FILE          like --check, then push the diff to Railway");
  console.error("");
  console.error("required env: RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_ID");
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});
