import { test, expect } from "bun:test";
import {
  generateIdentityOverride,
  generateTrialEnv,
  redactEnvForSnapshot,
  renderProgramsJson,
  programIdFor,
  DB_PATH,
} from "./generateConfig";
import type { PixieTrialRow } from "./types";

function fixtureTrial(overrides: Partial<PixieTrialRow> = {}): PixieTrialRow {
  return {
    id: "trial-1",
    requester_hca_id: "hca-1",
    requester_email: "a@b.com",
    requester_name: "Alex",
    requester_slack_id: null,
    program_name: "Athena",
    program_description: null,
    bot_name: null,
    status: "awaiting_slack_credentials",
    railway_account_pool_id: null,
    railway_project_id: null,
    railway_service_id: null,
    railway_environment_id: null,
    slack_workspace_id: null,
    slack_workspace_name: null,
    slack_bot_user_id: null,
    channels: {},
    sources: [],
    config_snapshot: null,
    llm_base_url: null,
    llm_model: null,
    llm_key_encrypted: null,
    slack_bot_token_encrypted: null,
    slack_app_token_encrypted: null,
    created_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    last_deploy_at: null,
    last_deploy_status: null,
    expiry_notified_at: null,
    paused_at: null,
    reclaim_deadline: null,
    deleted_at: null,
    ...overrides,
  };
}

const SECRETS = { botToken: "xoxb-fake", appToken: "xapp-fake", llmKey: "sk-fake" };

test("identity override names the program, not Pixl", () => {
  const text = generateIdentityOverride("Athena Bot", "Athena");
  expect(text).toMatch(/Athena/);
  expect(text).not.toMatch(/Ricky/i);
  expect(text).not.toMatch(/Pixorpheus/i);
});

// It used to tell every bot's users to run "/pixie", a command their Slack app
// does not have.
test("identity override advertises the bot's own slash command", () => {
  const text = generateIdentityOverride("Sol", "Solvable", "sol");
  expect(text).toMatch(/\/sol <question>/);
  expect(text).not.toMatch(/\/pixie/);
});

test("the default HCAI model needs no override", () => {
  const env = generateTrialEnv(fixtureTrial(), SECRETS);
  expect(env.HCAI_MODEL).toBeUndefined();
  expect(env.PIXIE_ANSWER_BASE_URL).toBeUndefined();
});

// The engine stopped reading this variable when the fallback moved to
// zenStandby(); still sending it just misleads whoever reads config_snapshot.
test("the dead PIXIE_ANSWER_FALLBACK_BASE_URL is no longer sent", () => {
  const env = generateTrialEnv(fixtureTrial({ llm_base_url: "https://my-gateway.example/v1" }), SECRETS);
  expect(env.PIXIE_ANSWER_FALLBACK_BASE_URL).toBeUndefined();
});

test("the configured model is carried through while the provider remains HCAI", () => {
  const env = generateTrialEnv(
    fixtureTrial({ llm_base_url: "https://my-gateway.example/v1", llm_model: "some-model" }),
    SECRETS,
  );
  expect(env.HCAI_MODEL).toBe("some-model");
  expect(env.PIXIE_ANSWER_BASE_URL).toBeUndefined();
});

test("help and faq channels are carried into SLACK_HELP_CHANNEL / SLACK_FAQ_CHANNELS", () => {
  const env = generateTrialEnv(
    fixtureTrial({
      channels: {
        helpChannel: { id: "C1", name: "help" },
        faqChannels: [{ id: "C2", name: "faq" }, { id: "C3", name: "general" }],
      },
    }),
    SECRETS,
  );
  expect(env.SLACK_HELP_CHANNEL).toBe("C1");
  expect(env.SLACK_FAQ_CHANNELS).toBe("C2,C3");
});

test("requester's slack id becomes the trial's own admin", () => {
  const env = generateTrialEnv(fixtureTrial({ requester_slack_id: "U999" }), SECRETS);
  expect(env.PIXIE_ADMIN_USER_IDS).toBe("U999");
});

test("an explicit admin list is sent whole", () => {
  const env = generateTrialEnv(
    fixtureTrial({ requester_slack_id: "U999", admin_slack_ids: ["U1", "U2"] }),
    SECRETS,
  );
  expect(env.PIXIE_ADMIN_USER_IDS).toBe("U1,U2");
});

test("no requester slack id means no admin — fails closed like pixie's own default", () => {
  const env = generateTrialEnv(fixtureTrial(), SECRETS);
  expect(env.PIXIE_ADMIN_USER_IDS).toBeUndefined();
});

/* ------------------------------------------------ the programs blob -- */
// The bug this closes: sources were collected by the wizard, written to Supabase,
// and then never sent to the bot. The deployed bot found no override, fell through
// to the image's own sources.json, and answered from Pixl's docs.

test("sources reach the bot through PIXIE_PROGRAMS_JSON", () => {
  const env = generateTrialEnv(
    fixtureTrial({
      program_name: "Solvable",
      sources: [{ name: "Solvable Docs", type: "url", url: "https://solvable.hackclub.com/docs" }],
    }),
    SECRETS,
  );

  const parsed = JSON.parse(env.PIXIE_PROGRAMS_JSON);
  expect(parsed.programs[0].sources[0].url).toBe("https://solvable.hackclub.com/docs");
  expect(parsed.programs[0].sources[0].name).toBe("Solvable Docs");
});

// The engine keys its cache and citations on `name`; a source carrying only the
// wizard's older `label` would arrive nameless and get dropped by loadSources().
test("a source's label is used as its name when name is absent", () => {
  const json = renderProgramsJson(fixtureTrial({ sources: [{ label: "Legacy FAQ", type: "url", url: "u" }] }));
  expect(JSON.parse(json).programs[0].sources[0].name).toBe("Legacy FAQ");
});

test("an inline FAQ travels in the blob with no url", () => {
  const json = renderProgramsJson(
    fixtureTrial({
      sources: [{ name: "Bot FAQ", type: "json-faq", content: [{ question: "q", answer: "a" }] }],
    }),
  );
  const source = JSON.parse(json).programs[0].sources[0];
  expect(source.content).toEqual([{ question: "q", answer: "a" }]);
  expect(source.url).toBeUndefined();
});

test("the help channel is included in the program's channel list", () => {
  const json = renderProgramsJson(
    fixtureTrial({
      channels: { helpChannel: { id: "C1", name: "help" }, faqChannels: [{ id: "C2", name: "faq" }] },
    }),
  );
  const program = JSON.parse(json).programs[0];
  expect(program.helpChannel).toBe("C1");
  expect(program.channels).toEqual(["C1", "C2"]);
});

// A help channel that's also in the FAQ list must not appear twice — the engine
// builds its channel map from this and a duplicate would shadow the help entry.
test("a help channel already in the faq list is not duplicated", () => {
  const json = renderProgramsJson(
    fixtureTrial({
      channels: { helpChannel: { id: "C1", name: "help" }, faqChannels: [{ id: "C1", name: "help" }] },
    }),
  );
  expect(JSON.parse(json).programs[0].channels).toEqual(["C1"]);
});

test("posture, scope, guides and milestones ride in the blob, not their own vars", () => {
  const trial = fixtureTrial({
    posture: "passive",
    scope: "program",
    guides: ["create-devboard"],
    milestones: [{ name: "Launch", date: "2026-09-01" }],
  });
  const env = generateTrialEnv(trial, SECRETS);
  const program = JSON.parse(env.PIXIE_PROGRAMS_JSON).programs[0];

  expect(program.posture).toBe("passive");
  expect(program.scope).toBe("program");
  expect(program.guides).toEqual(["create-devboard"]);
  expect(program.milestones[0].name).toBe("Launch");
  expect(env.PIXIE_POSTURE).toBeUndefined();
  expect(env.PIXIE_SCOPE).toBeUndefined();
});

test("scope defaults to program so a bot doesn't answer everything unprompted", () => {
  expect(JSON.parse(renderProgramsJson(fixtureTrial())).programs[0].scope).toBe("program");
});

test("guides default to the fleet-wide YSWS submission walkthrough", () => {
  expect(JSON.parse(renderProgramsJson(fixtureTrial())).programs[0].guides).toEqual(["submit-ysws-guidelines"]);
});

// The id keys forChannel/get/posture lookups in the engine, so it has to be a
// slug — a display name with spaces would not survive the round trip.
test("the program id is slugified from the program name when no slug is set", () => {
  expect(programIdFor(fixtureTrial({ program_name: "Solvable YSWS!" }))).toBe("solvable-ysws");
});

test("an explicit slug wins over the derived one", () => {
  expect(programIdFor(fixtureTrial({ program_name: "Solvable", program_slug: "solv" }))).toBe("solv");
});

/* ---------------------------------------------------- naming and volume -- */

test("the bot's name and command slug are sent", () => {
  const env = generateTrialEnv(fixtureTrial({ bot_name: "Sol", bot_slug: "sol" }), SECRETS);
  expect(env.PIXIE_BOT_NAME).toBe("Sol");
  expect(env.PIXIE_BOT_SLUG).toBe("sol");
});

test("bot name falls back to the program name", () => {
  const env = generateTrialEnv(fixtureTrial({ program_name: "Athena", bot_name: null }), SECRETS);
  expect(env.PIXIE_BOT_NAME).toBe("Athena");
});

// Without this the sqlite file sits next to the code and every redeploy — which
// under auto-deploy is every push to main — wipes the answer cache, learned
// facts and ticket records.
test("the database is pointed at the Railway volume", () => {
  const env = generateTrialEnv(fixtureTrial(), SECRETS);
  expect(env.PIXIE_DB_PATH).toBe(DB_PATH);
  expect(DB_PATH.startsWith("/data/")).toBe(true);
});

/* -------------------------------------------------- optional behaviour -- */

test("the deployment sends exactly one HCAI key", () => {
  const env = generateTrialEnv(fixtureTrial(), SECRETS);
  expect(env.HCAI_API_KEY).toBe("sk-fake");
  expect(Object.keys(env).filter((key) => /^HCAI_API_KEY(?:_|$)/.test(key))).toEqual(["HCAI_API_KEY"]);
});

test("optional behaviour vars are omitted when unset, so engine defaults apply", () => {
  const env = generateTrialEnv(fixtureTrial(), SECRETS);
  expect(env.PIXIE_ESCALATE_REACTION).toBeUndefined();
  expect(env.PIXIE_FEEDBACK_REACTIONS).toBeUndefined();
  expect(env.PIXIE_REPORT_CHANNEL).toBeUndefined();
  expect(env.FIRECRAWL_API_KEY).toBeUndefined();
  expect(env.REFRESH_INTERVAL_MIN).toBeUndefined();
});

test("escalation and feedback reactions are carried when chosen", () => {
  const env = generateTrialEnv(
    fixtureTrial({ escalate_reaction: "sos", feedback_reactions: ["yesyes", "no"] }),
    SECRETS,
  );
  expect(env.PIXIE_ESCALATE_REACTION).toBe("sos");
  expect(env.PIXIE_FEEDBACK_REACTIONS).toBe("yesyes,no");
});

// The engine already defaults the report to the help channel, so sending an
// identical value is noise in the snapshot.
test("a report channel equal to the help channel is not sent", () => {
  const env = generateTrialEnv(
    fixtureTrial({ channels: { helpChannel: { id: "C1", name: "help" } }, report_channel: "C1" }),
    SECRETS,
  );
  expect(env.PIXIE_REPORT_CHANNEL).toBeUndefined();
});

test("a report channel elsewhere is sent", () => {
  const env = generateTrialEnv(
    fixtureTrial({ channels: { helpChannel: { id: "C1", name: "help" } }, report_channel: "C9" }),
    SECRETS,
  );
  expect(env.PIXIE_REPORT_CHANNEL).toBe("C9");
});

test("a firecrawl key is treated as a secret in the snapshot", () => {
  const env = generateTrialEnv(fixtureTrial(), { ...SECRETS, firecrawlKey: "fc-key" });
  expect(env.FIRECRAWL_API_KEY).toBe("fc-key");
  expect(redactEnvForSnapshot(env).FIRECRAWL_API_KEY).toBe("(hidden)");
});

test("redaction hides tokens and keys but leaves everything else readable", () => {
  const env = generateTrialEnv(fixtureTrial(), SECRETS);
  const redacted = redactEnvForSnapshot(env);
  expect(redacted.SLACK_BOT_TOKEN).toBe("(hidden)");
  expect(redacted.SLACK_APP_TOKEN).toBe("(hidden)");
  expect(redacted.HCAI_API_KEY).toBe("(hidden)");
  expect(redacted.PIXIE_IDENTITY_OVERRIDE).toBe(env.PIXIE_IDENTITY_OVERRIDE);
});
