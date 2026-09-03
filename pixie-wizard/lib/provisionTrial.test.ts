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
    status: "awaiting_slack_credentials",
    railway_account_pool_id: null,
    railway_project_id: null,
    railway_service_id: null,
    railway_environment_id: null,
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

// bun's mock.module patches the module registry for the whole test run, not
// per-file — every test file mocking "@/lib/trials" needs the SAME full
// shape (the union of everything any consumer imports from it), or whichever
// file's mock.module call runs last silently clobbers the others' exports.
// See the identical mock in sweepTrials.test.ts.
const trialsMock = {
  getTrialById: mock(async (_id: string) => fixtureTrial()),
  updateTrial: mock(async (_id: string, patch: Partial<PixieTrialRow>) => fixtureTrial(patch)),
  logTrialEvent: mock(async () => {}),
  findExpiredActiveTrials: mock(async (_now: Date) => [] as PixieTrialRow[]),
  findReclaimableTrials: mock(async (_now: Date) => [] as PixieTrialRow[]),
  findTrialsNeedingExpiryWarning: mock(async (_now: Date, _ms: number) => [] as PixieTrialRow[]),
};

const poolMock = {
  pickPoolAccount: mock(async () => ({ id: "pool-1", label: "acct-1", apiToken: "rw-token" })),
  claimPoolAccount: mock(async () => {}),
  releasePoolAccount: mock(async () => {}),
  penalizePoolAccount: mock(async () => {}),
  getPoolAccountToken: mock(async (_id: string) => "rw-token"),
  PoolExhaustedError: class PoolExhaustedError extends Error {},
};

const railwayMock = {
  createProjectAndService: mock(async () => ({ projectId: "p1", environmentId: "e1", serviceId: "s1" })),
  createVolume: mock(async () => "vol1"),
  setVariables: mock(async () => {}),
  triggerDeploy: mock(async () => {}),
  latestDeploymentStatus: mock(async () => null as { id: string; status: string } | null),
  isTerminalDeploymentStatus: (status: string) => ["SUCCESS", "FAILED", "CRASHED", "REMOVED"].includes(status),
};

mock.module("@/lib/trials", () => trialsMock);
mock.module("@/lib/railwayPool", () => poolMock);
mock.module("@/lib/railway", () => railwayMock);
mock.module("@/lib/crypto", () => ({
  decryptSecret: (v: string) => `decrypted:${v}`,
  encryptSecret: (v: string) => `encrypted:${v}`,
}));

const { provisionTrial, checkTrialDeployStatus } = await import("./provisionTrial");

beforeEach(() => {
  trialsMock.getTrialById.mockReset();
  trialsMock.getTrialById.mockImplementation(async () => fixtureTrial());
  trialsMock.updateTrial.mockClear();
  trialsMock.logTrialEvent.mockClear();
  poolMock.pickPoolAccount.mockClear();
  poolMock.claimPoolAccount.mockClear();
  poolMock.releasePoolAccount.mockClear();
  poolMock.penalizePoolAccount.mockClear();
  poolMock.getPoolAccountToken.mockClear();
  railwayMock.createProjectAndService.mockReset();
  railwayMock.createProjectAndService.mockImplementation(async () => ({
    projectId: "p1",
    environmentId: "e1",
    serviceId: "s1",
  }));
  railwayMock.setVariables.mockReset();
  railwayMock.setVariables.mockImplementation(async () => {});
  railwayMock.createVolume.mockReset();
  railwayMock.createVolume.mockImplementation(async () => "vol1");
  railwayMock.triggerDeploy.mockReset();
  railwayMock.triggerDeploy.mockImplementation(async () => {});
  railwayMock.latestDeploymentStatus.mockReset();
});

test("WIZARD_DRY_RUN skips every Railway/pool call and marks the trial active immediately", async () => {
  process.env.WIZARD_DRY_RUN = "1";
  try {
    await provisionTrial("trial-1");
  } finally {
    delete process.env.WIZARD_DRY_RUN;
  }

  expect(poolMock.pickPoolAccount).not.toHaveBeenCalled();
  expect(railwayMock.createProjectAndService).not.toHaveBeenCalled();

  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("active");
  expect(patch.last_deploy_status).toBe("DRY_RUN");
  expect(patch.config_snapshot).toBeDefined();
});

test("provisionTrial happy path claims a pool account and moves the trial to provisioning", async () => {
  await provisionTrial("trial-1");

  expect(poolMock.pickPoolAccount).toHaveBeenCalledTimes(1);
  expect(poolMock.claimPoolAccount).toHaveBeenCalledWith("pool-1");
  expect(railwayMock.createProjectAndService).toHaveBeenCalledTimes(1);
  expect(railwayMock.setVariables).toHaveBeenCalledTimes(1);
  expect(railwayMock.triggerDeploy).toHaveBeenCalledTimes(1);

  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("provisioning");
  expect(patch.railway_project_id).toBe("p1");
});

test("provisionTrial refuses a trial that isn't awaiting_slack_credentials", async () => {
  trialsMock.getTrialById.mockImplementation(async () => fixtureTrial({ status: "draft" }));
  await expect(provisionTrial("trial-1")).rejects.toThrow(/not ready to provision/);
  expect(poolMock.pickPoolAccount).not.toHaveBeenCalled();
});

test("provisionTrial refuses a trial missing required secrets", async () => {
  trialsMock.getTrialById.mockImplementation(async () => fixtureTrial({ llm_key_encrypted: null }));
  await expect(provisionTrial("trial-1")).rejects.toThrow(/missing required secrets/);
});

test("a failure creating the Railway project releases and penalizes the pool account, marks the trial failed", async () => {
  railwayMock.createProjectAndService.mockImplementation(async () => {
    throw new Error("Railway is down");
  });

  await expect(provisionTrial("trial-1")).rejects.toThrow("Railway is down");

  expect(poolMock.releasePoolAccount).toHaveBeenCalledWith("pool-1");
  expect(poolMock.penalizePoolAccount).toHaveBeenCalledWith("pool-1");
  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("failed");
});

test("a failure setting variables also releases the pool account even though the project was already created", async () => {
  railwayMock.setVariables.mockImplementation(async () => {
    throw new Error("bad variable payload");
  });

  await expect(provisionTrial("trial-1")).rejects.toThrow("bad variable payload");
  expect(poolMock.releasePoolAccount).toHaveBeenCalledWith("pool-1");
});

/* -------------------------------------------------------------- volume -- */
// The engine opens its SQLite database on boot, so the volume has to exist before
// the first deploy — attached afterwards, the first run wrote to a path that then
// vanished. And without a volume at all, every redeploy (which under auto-deploy
// is every push to main) discards the answer cache, learned facts and tickets.

test("a volume is created and mounted where PIXIE_DB_PATH points", async () => {
  await provisionTrial("trial-1");

  expect(railwayMock.createVolume).toHaveBeenCalledTimes(1);
  const [, target, mountPath] = railwayMock.createVolume.mock.calls[0];
  expect(target).toEqual({ projectId: "p1", environmentId: "e1", serviceId: "s1" });

  const env = railwayMock.setVariables.mock.calls[0][2] as Record<string, string>;
  expect(env.PIXIE_DB_PATH.startsWith(`${mountPath}/`)).toBe(true);
});

test("the volume is created before the deploy is triggered", async () => {
  const order: string[] = [];
  railwayMock.createVolume.mockImplementation(async () => {
    order.push("volume");
    return "vol1";
  });
  railwayMock.triggerDeploy.mockImplementation(async () => {
    order.push("deploy");
  });

  await provisionTrial("trial-1");
  expect(order).toEqual(["volume", "deploy"]);
});

test("the volume id is recorded on the trial", async () => {
  await provisionTrial("trial-1");
  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.railway_volume_id).toBe("vol1");
});

// A volume failure leaves a project behind, same as a deploy failure does, so it
// has to release and penalize the account rather than leaving it counted as busy.
test("a volume failure releases the pool account and marks the trial failed", async () => {
  railwayMock.createVolume.mockImplementation(async () => {
    throw new Error("volume quota exceeded");
  });

  await expect(provisionTrial("trial-1")).rejects.toThrow("volume quota exceeded");
  expect(poolMock.releasePoolAccount).toHaveBeenCalledWith("pool-1");
  expect(poolMock.penalizePoolAccount).toHaveBeenCalledWith("pool-1");
  expect(railwayMock.triggerDeploy).not.toHaveBeenCalled();

  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("failed");
  expect(patch.last_deploy_status).toBe("volume_failed");
});

// The bug this closes: sources were collected by the wizard and never sent, so
// every bot fell back to the engine image's own sources.json — Pixl's docs.
test("the deployed variables carry the trial's own sources", async () => {
  await provisionTrial("trial-1");

  const env = railwayMock.setVariables.mock.calls[0][2] as Record<string, string>;
  expect(env.PIXIE_PROGRAMS_JSON).toBeDefined();
  expect(JSON.parse(env.PIXIE_PROGRAMS_JSON).programs[0].sources[0].url).toBe("https://x.com");
});

test("checkTrialDeployStatus short-circuits for a trial that's already past provisioning", async () => {
  trialsMock.getTrialById.mockImplementation(async () => fixtureTrial({ status: "active" }));
  const result = await checkTrialDeployStatus("trial-1");
  expect(result.done).toBe(true);
  expect(railwayMock.latestDeploymentStatus).not.toHaveBeenCalled();
});

test("checkTrialDeployStatus reports QUEUED before any deployment exists yet", async () => {
  trialsMock.getTrialById.mockImplementation(async () =>
    fixtureTrial({
      status: "provisioning",
      railway_project_id: "p1",
      railway_environment_id: "e1",
      railway_service_id: "s1",
      railway_account_pool_id: "pool-1",
    }),
  );
  railwayMock.latestDeploymentStatus.mockImplementation(async () => null);

  const result = await checkTrialDeployStatus("trial-1");
  expect(result).toEqual({ status: "QUEUED", done: false });
});

test("checkTrialDeployStatus flips the trial active with a 14-day expiry on SUCCESS", async () => {
  trialsMock.getTrialById.mockImplementation(async () =>
    fixtureTrial({
      status: "provisioning",
      railway_project_id: "p1",
      railway_environment_id: "e1",
      railway_service_id: "s1",
      railway_account_pool_id: "pool-1",
    }),
  );
  railwayMock.latestDeploymentStatus.mockImplementation(async () => ({ id: "dep1", status: "SUCCESS" }));

  const result = await checkTrialDeployStatus("trial-1");
  expect(result.done).toBe(true);

  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("active");
  const expiresInDays = (new Date(patch.expires_at as string).getTime() - Date.now()) / 86_400_000;
  expect(expiresInDays).toBeGreaterThan(13.9);
  expect(expiresInDays).toBeLessThan(14.1);
});

test("checkTrialDeployStatus releases the pool account and marks the trial failed on a crashed build", async () => {
  trialsMock.getTrialById.mockImplementation(async () =>
    fixtureTrial({
      status: "provisioning",
      railway_project_id: "p1",
      railway_environment_id: "e1",
      railway_service_id: "s1",
      railway_account_pool_id: "pool-1",
    }),
  );
  railwayMock.latestDeploymentStatus.mockImplementation(async () => ({ id: "dep1", status: "CRASHED" }));

  const result = await checkTrialDeployStatus("trial-1");
  expect(result.done).toBe(true);
  expect(poolMock.releasePoolAccount).toHaveBeenCalledWith("pool-1");

  const patch = trialsMock.updateTrial.mock.calls.at(-1)?.[1] as Partial<PixieTrialRow>;
  expect(patch.status).toBe("failed");
});
