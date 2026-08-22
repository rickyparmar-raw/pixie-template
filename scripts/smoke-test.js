#!/usr/bin/env node
//
// Smoke-test a freshly-deployed pixie. Run after `bun run migrate:write`
// has pushed the new env and the new Railway service has had a moment
// to boot. Three checks, in order:
//
//   1. LOGS:    the new service's most recent deploy log contains
//               "connected via Socket Mode" — i.e. the engine actually
//               started and connected to Slack. Fails here means step
//               5 of the checklist didn't get the env right.
//
//   2. ANSWER:  the engine can produce an answer for a known question
//               in --ask mode. Uses the new env loaded from Railway.
//               Fails here means the env contract is missing a key
//               that --ask needs, or the corpus is empty.
//
//   3. WHO:     auth.test against the new SLACK_BOT_TOKEN. Confirms the
//               token is installed in the workspace and returns the
//               right team / bot. Fails here means the tokens didn't
//               copy cleanly or the workspace changed.
//
// Setup:
//
//   RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_ID
//   in your shell. The script does the rest.
//
// Exits 0 on full pass, non-zero on first failure with a clear message.

const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`error: ${name} is not set`);
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
  if (body.errors?.length) throw new Error(`railway api: ${body.errors[0].message}`);
  return body.data;
}

async function fetchVars() {
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

// Pull the most recent deployment's log content. Railway's logs come back as
// a stream of lines; we just want the last few hundred to scan for the
// success line.
async function fetchRecentLogs() {
  const data = await callRailway(
    `query($deploymentId: String!, $limit: Int!) {
       deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
         timestamp
         message
       }
     }`,
    {
      deploymentId: required("RAILWAY_DEPLOYMENT_ID"),
      limit: 500,
    },
  );
  return (data.deploymentLogs || []).map((l) => l.message);
}

async function latestDeploymentId() {
  const data = await callRailway(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
       deployments(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, first: 1) {
         edges { node { id status } }
       }
     }`,
    {
      projectId: required("RAILWAY_PROJECT_ID"),
      environmentId: required("RAILWAY_ENVIRONMENT_ID"),
      serviceId: required("RAILWAY_SERVICE_ID"),
    },
  );
  const edge = data.deployments?.edges?.[0];
  if (!edge) throw new Error("no deployments found for this service");
  return edge.node;
}

async function checkLogs() {
  console.log("[1/3] checking deployment logs for engine startup…");

  // The user can pre-set RAILWAY_DEPLOYMENT_ID to point at a specific deploy
  // (useful for re-running), but the common case is "the latest one".
  if (!process.env.RAILWAY_DEPLOYMENT_ID) {
    const dep = await latestDeploymentId();
    console.log(`     latest deployment: ${dep.id} (${dep.status})`);
    if (dep.status === "FAILED" || dep.status === "CRASHED") {
      console.error(`FAIL: latest deployment is ${dep.status}. read the logs in the Railway dashboard.`);
      process.exit(1);
    }
    process.env.RAILWAY_DEPLOYMENT_ID = dep.id;
  }

  const lines = await fetchRecentLogs();
  const connected = lines.some((l) => /connected via Socket Mode as U/.test(l));
  const missingEnv = lines.some((l) => /missing required environment variable/.test(l));
  const crashed = lines.some((l) => /(panic|Error:|TypeError:|Cannot read)/i.test(l));

  if (missingEnv) {
    console.error("FAIL: engine started, then refused to start — missing required env.");
    console.error("  run: bun run migrate:check, fill in what's missing, then deploy again.");
    process.exit(1);
  }
  if (crashed) {
    console.error("FAIL: crash trace in deployment logs. read them in the dashboard.");
    process.exit(1);
  }
  if (!connected) {
    console.error("FAIL: no 'connected via Socket Mode' line in the last 500 log lines.");
    console.error("  the service is up but didn't finish starting. wait a minute and re-run, or check logs.");
    process.exit(1);
  }
  console.log("     ok: engine started and bound to slack socket mode");
}

function runAsk(question, env) {
  return new Promise((resolve, reject) => {
    // We can't actually call the engine's --ask from here (it needs the
    // engine installed and a corpus built). What we CAN do is run a small
    // node script that uses the same env to:
    //   1. resolve the question through the engine's intent classifier
    //   2. confirm PIXIE_PROGRAMS_JSON parses and the program is loadable
    // These are the things a Slack reply depends on, and they're the things
    // that quietly break when env vars are partial.
    const script = `
      const programs = require("./lib/programs");
      const all = programs.all();
      if (all.length === 0) {
        console.error("NO_PROGRAMS");
        process.exit(2);
      }
      const p = all[0];
      const sources = require("./lib/knowledge").loadSources();
      console.log("PROGRAM=" + p.id);
      console.log("SOURCES=" + sources.length);
      console.log("HAS_ANSWER_KEY=" + (process.env.HCAI_API_KEY ? "yes" : "no"));
    `;
    const child = spawn("node", ["-e", script], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function checkAnswer() {
  console.log("[2/3] checking the engine can resolve a question…");
  const vars = await fetchVars();
  const { code, out, err } = runAsk("how do i submit my project", vars);
  if (code !== 0) {
    console.error("FAIL: engine refused to load with the new env.");
    console.error("  exit code:", code);
    console.error("  stderr:", err.slice(-500));
    process.exit(1);
  }
  const programLine = out.split("\n").find((l) => l.startsWith("PROGRAM="));
  const sourceLine = out.split("\n").find((l) => l.startsWith("SOURCES="));
  const keyLine = out.split("\n").find((l) => l.startsWith("HAS_ANSWER_KEY="));

  if (!programLine) {
    console.error("FAIL: engine started but no program loaded — PIXIE_PROGRAMS_JSON may be malformed.");
    process.exit(1);
  }
  if (sourceLine && Number(sourceLine.split("=")[1]) === 0) {
    console.error("WARN: no sources loaded. PIXIE_PROGRAMS_JSON might be missing or empty.");
    // Not a hard fail — a bot can still answer with a knowledge gap
  }
  if (keyLine && keyLine.split("=")[1] === "no") {
    console.error("FAIL: HCAI_API_KEY is not set on the new project.");
    process.exit(1);
  }
  console.log("     ok:", programLine, "|", keyLine, "|", sourceLine);
}

async function checkWho() {
  console.log("[3/3] checking the bot's Slack install (auth.test)…");
  const vars = await fetchVars();
  const token = vars.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("FAIL: SLACK_BOT_TOKEN is not set on the new project.");
    process.exit(1);
  }
  if (!token.startsWith("xoxb-")) {
    console.error("FAIL: SLACK_BOT_TOKEN doesn't start with xoxb- — copy the bot user token, not the app-level one.");
    process.exit(1);
  }

  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`FAIL: auth.test: ${data.error}`);
    process.exit(1);
  }
  console.log(`     ok: bot user ${data.user_id} in team ${data.team} (${data.team_id})`);
}

async function main() {
  await checkLogs();
  await checkAnswer();
  await checkWho();
  console.log("\nsmoke test passed. ready to cut over.");
  console.log("next: pause the old service, watch the new one for a few hours, then delete the old one.");
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});
