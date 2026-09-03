import { test, expect, mock, beforeEach } from "bun:test";
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
    bot_name: "Athena Bot",
    status: "active",
    railway_account_pool_id: "pool-1",
    railway_project_id: "p1",
    railway_service_id: "s1",
    railway_environment_id: "e1",
    slack_workspace_id: "T1",
    slack_workspace_name: "Hack Club",
    slack_bot_user_id: "U1",
    channels: { helpChannel: { id: "C1", name: "help" } },
    sources: [{ type: "url", url: "https://x.com" }],
    config_snapshot: null,
    llm_base_url: null,
    llm_model: null,
    llm_key_encrypted: "enc-llm",
    slack_bot_token_encrypted: "enc-bot",
    slack_app_token_encrypted: "enc-app",
    created_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-01T00:00:00Z",
    last_deploy_at: null,
    last_deploy_status: null,
    expiry_notified_at: null,
    paused_at: null,
    reclaim_deadline: null,
    deleted_at: null,
    ...overrides,
  };
}

// bun's mock.module patches the module registry for the whole test run, not
// per-file — every test file mocking these modules needs the SAME full shape
// (the union of everything any consumer imports), or whichever file's
// mock.module call runs last silently clobbers the others' exports. See the
// identical mocks in provisionTrial.test.ts.
const trialsMock = {
  findExpiredActiveTrials: mock(async (_now: Date) => [] as PixieTrialRow[]),
  findReclaimableTrials: mock(async (_now: Date) => [] as PixieTrialRow[]),
  findTrialsNeedingExpiryWarning: mock(async (_now: Date, _ms: number) => [] as PixieTrialRow[]),
  updateTrial: mock(async (_id: string, patch: Partial<PixieTrialRow>) => fixtureTrial(patch)),
  logTrialEvent: mock(async () => {}),
  getTrialById: mock(async (_id: string) => fixtureTrial()),
};

const poolMock = {
  getPoolAccountToken: mock(async (_id: string) => "rw-token"),
  releasePoolAccount: mock(async () => {}),
  pickPoolAccount: mock(async () => ({ id: "pool-1", label: "acct-1", apiToken: "rw-token" })),
  claimPoolAccount: mock(async () => {}),
  penalizePoolAccount: mock(async () => {}),
  PoolExhaustedError: class PoolExhaustedError extends Error {},
};

const railwayMock = {
  pauseService: mock(async () => {}),
  deleteProject: mock(async () => {}),
  createProjectAndService: mock(async () => ({ projectId: "p1", environmentId: "e1", serviceId: "s1" })),
  setVariables: mock(async () => {}),
  triggerDeploy: mock(async () => {}),
  latestDeploymentStatus: mock(async () => null as { id: string; status: string } | null),
  isTerminalDeploymentStatus: (status: string) => ["SUCCESS", "FAILED", "CRASHED", "REMOVED"].includes(status),
};

const notifyMock = {
  notifyTrial: mock(async () => {}),
};

mock.module("@/lib/trials", () => trialsMock);
mock.module("@/lib/railwayPool", () => poolMock);
mock.module("@/lib/railway", () => railwayMock);
mock.module("@/lib/notify", () => notifyMock);

const { sweepTrials } = await import("./sweepTrials");

beforeEach(() => {
  trialsMock.findExpiredActiveTrials.mockReset();
  trialsMock.findExpiredActiveTrials.mockImplementation(async () => []);
  trialsMock.findReclaimableTrials.mockReset();
  trialsMock.findReclaimableTrials.mockImplementation(async () => []);
  trialsMock.findTrialsNeedingExpiryWarning.mockReset();
  trialsMock.findTrialsNeedingExpiryWarning.mockImplementation(async () => []);
  trialsMock.updateTrial.mockClear();
  trialsMock.logTrialEvent.mockClear();
  poolMock.getPoolAccountToken.mockClear();
  poolMock.releasePoolAccount.mockClear();
  railwayMock.pauseService.mockReset();
  railwayMock.pauseService.mockImplementation(async () => {});
  railwayMock.deleteProject.mockReset();
  railwayMock.deleteProject.mockImplementation(async () => {});
  notifyMock.notifyTrial.mockClear();
});

test("an expired active trial gets paused on Railway and flipped to paused with a 7-day reclaim window", async () => {
  const now = new Date("2026-02-01T00:00:00Z");
  trialsMock.findExpiredActiveTrials.mockImplementation(async () => [fixtureTrial()]);

  const result = await sweepTrials(now);

  expect(railwayMock.pauseService).toHaveBeenCalledTimes(1);
  expect(notifyMock.notifyTrial).toHaveBeenCalledTimes(1);
  const patch = trialsMock.updateTrial.mock.calls[0]?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("paused");
  const days = (new Date(patch.reclaim_deadline as string).getTime() - now.getTime()) / 86_400_000;
  expect(days).toBeCloseTo(7, 1);
  expect(result.paused).toBe(1);
  expect(result.errors).toEqual([]);
});

test("a trial missing Railway ids still gets paused in the DB without crashing the sweep", async () => {
  trialsMock.findExpiredActiveTrials.mockImplementation(async () => [
    fixtureTrial({ railway_project_id: null, railway_environment_id: null, railway_service_id: null }),
  ]);

  const result = await sweepTrials();

  expect(railwayMock.pauseService).not.toHaveBeenCalled();
  expect(result.paused).toBe(1);
});

test("one trial failing to pause doesn't stop the rest of the sweep", async () => {
  trialsMock.findExpiredActiveTrials.mockImplementation(async () => [
    fixtureTrial({ id: "trial-bad" }),
    fixtureTrial({ id: "trial-ok" }),
  ]);
  railwayMock.pauseService.mockImplementation(async () => {
    throw new Error("Railway unreachable");
  });

  const result = await sweepTrials();

  expect(result.paused).toBe(0);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toMatch(/trial-bad/);
});

test("a paused trial past its reclaim deadline is deleted from Railway and scrubbed of secrets", async () => {
  trialsMock.findReclaimableTrials.mockImplementation(async () => [fixtureTrial({ status: "paused" })]);

  const result = await sweepTrials();

  expect(railwayMock.deleteProject).toHaveBeenCalledWith("rw-token", "p1");
  expect(poolMock.releasePoolAccount).toHaveBeenCalledWith("pool-1");
  const patch = trialsMock.updateTrial.mock.calls[0]?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("deleted");
  expect(patch.llm_key_encrypted).toBeNull();
  expect(patch.slack_bot_token_encrypted).toBeNull();
  expect(patch.slack_app_token_encrypted).toBeNull();
  expect(result.deleted).toBe(1);
});

test("a trial nearing expiry gets a heads-up notice and expiry_notified_at is stamped", async () => {
  trialsMock.findTrialsNeedingExpiryWarning.mockImplementation(async () => [fixtureTrial()]);

  const result = await sweepTrials();

  expect(notifyMock.notifyTrial).toHaveBeenCalledTimes(1);
  const patch = trialsMock.updateTrial.mock.calls[0]?.[1] as Partial<PixieTrialRow>;
  expect(patch.expiry_notified_at).toBeDefined();
  expect(result.warned).toBe(1);
});

test("an empty pool across all three buckets is a clean no-op", async () => {
  const result = await sweepTrials();
  expect(result).toEqual({ paused: 0, deleted: 0, warned: 0, errors: [] });
});
