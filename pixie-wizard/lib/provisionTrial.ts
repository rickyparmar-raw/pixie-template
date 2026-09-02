import { getTrialById, updateTrial, logTrialEvent } from "@/lib/trials";
import { decryptSecret } from "@/lib/crypto";
import { generateTrialEnv, redactEnvForSnapshot, VOLUME_MOUNT_PATH } from "@/lib/generateConfig";
import {
  pickPoolAccount,
  claimPoolAccount,
  releasePoolAccount,
  penalizePoolAccount,
  getPoolAccountToken,
} from "@/lib/railwayPool";
import {
  createProjectAndService,
  createVolume,
  setVariables,
  triggerDeploy,
  latestDeploymentStatus,
  isTerminalDeploymentStatus,
  type ProvisionedService,
} from "@/lib/railway";

const TRIAL_DAYS = 14;

// Kicks off provisioning and returns once the deploy is triggered — it does
// NOT block until the build finishes. Railway builds can run well past a
// single serverless function's execution window, so status is checked
// separately by checkTrialDeployStatus, polled from the client the way the
// plan's step 7 describes ("trigger deploy, poll status live").
export async function provisionTrial(trialId: string): Promise<void> {
  const trial = await getTrialById(trialId);
  if (!trial) throw new Error(`No trial ${trialId}`);
  if (trial.status !== "awaiting_slack_credentials") {
    throw new Error(`Trial ${trialId} is not ready to provision (status: ${trial.status})`);
  }
  if (!trial.slack_bot_token_encrypted || !trial.slack_app_token_encrypted || !trial.llm_key_encrypted) {
    throw new Error(`Trial ${trialId} is missing required secrets`);
  }

  if (process.env.WIZARD_DRY_RUN) {
    const env = generateTrialEnv(trial, {
      botToken: decryptSecret(trial.slack_bot_token_encrypted),
      appToken: decryptSecret(trial.slack_app_token_encrypted),
      llmKey: decryptSecret(trial.llm_key_encrypted),
      firecrawlKey: trial.firecrawl_key_encrypted ? decryptSecret(trial.firecrawl_key_encrypted) : undefined,
    });
    const redacted = redactEnvForSnapshot(env);
    console.log(`[WIZARD_DRY_RUN] would provision trial ${trial.id} (${trial.program_name}) with:`, redacted);
    await updateTrial(trial.id, {
      status: "active",
      railway_project_id: "dry-run-project",
      railway_environment_id: "dry-run-environment",
      railway_service_id: "dry-run-service",
      railway_volume_id: "dry-run-volume",
      config_snapshot: redacted,
      last_deploy_at: new Date().toISOString(),
      last_deploy_status: "DRY_RUN",
      expires_at: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    await logTrialEvent(trial.id, "provision_dry_run", {});
    return;
  }

  const account = await pickPoolAccount();
  await claimPoolAccount(account.id);

  let target: ProvisionedService;
  try {
    target = await createProjectAndService(account.apiToken, `pixie-trial-${trial.program_name}`.slice(0, 60));
  } catch (err) {
    await releasePoolAccount(account.id);
    await penalizePoolAccount(account.id);
    await updateTrial(trial.id, { status: "failed", last_deploy_status: "provision_failed" });
    await logTrialEvent(trial.id, "provision_failed", { stage: "create", error: String(err) });
    throw err;
  }

  const env = generateTrialEnv(trial, {
    botToken: decryptSecret(trial.slack_bot_token_encrypted),
    appToken: decryptSecret(trial.slack_app_token_encrypted),
    llmKey: decryptSecret(trial.llm_key_encrypted),
    firecrawlKey: trial.firecrawl_key_encrypted ? decryptSecret(trial.firecrawl_key_encrypted) : undefined,
  });

  // Before the deploy, not after: the engine opens its database on boot, so a
  // volume attached later means the first run wrote to a path that then vanished.
  // env.PIXIE_DB_PATH points inside this mount — creating one without the other
  // is worse than neither, so they're deliberately adjacent.
  let volumeId: string;
  try {
    volumeId = await createVolume(account.apiToken, target, VOLUME_MOUNT_PATH);
  } catch (err) {
    await releasePoolAccount(account.id);
    await penalizePoolAccount(account.id);
    await updateTrial(trial.id, { status: "failed", last_deploy_status: "volume_failed" });
    await logTrialEvent(trial.id, "provision_failed", { stage: "volume", error: String(err) });
    throw err;
  }

  try {
    await setVariables(account.apiToken, target, env);
    await triggerDeploy(account.apiToken, target);
  } catch (err) {
    await releasePoolAccount(account.id);
    await penalizePoolAccount(account.id);
    await updateTrial(trial.id, { status: "failed", last_deploy_status: "deploy_failed" });
    await logTrialEvent(trial.id, "provision_failed", { stage: "deploy", error: String(err) });
    throw err;
  }

  await updateTrial(trial.id, {
    status: "provisioning",
    railway_account_pool_id: account.id,
    railway_project_id: target.projectId,
    railway_environment_id: target.environmentId,
    railway_service_id: target.serviceId,
    railway_volume_id: volumeId,
    config_snapshot: redactEnvForSnapshot(env),
    last_deploy_at: new Date().toISOString(),
    last_deploy_status: "QUEUED",
  });
  await logTrialEvent(trial.id, "provision_started", { poolAccount: account.label });
}

export interface DeployStatusResult {
  status: string;
  done: boolean;
}

// Cheap on-demand check, not a long poll — call this repeatedly from the
// client (e.g. every few seconds) rather than blocking a server function on
// it. Flips the trial to active/failed the moment the deploy reaches a
// terminal state.
export async function checkTrialDeployStatus(trialId: string): Promise<DeployStatusResult> {
  const trial = await getTrialById(trialId);
  if (!trial) throw new Error(`No trial ${trialId}`);
  if (trial.status !== "provisioning") {
    return { status: trial.last_deploy_status ?? trial.status, done: true };
  }
  if (!trial.railway_project_id || !trial.railway_environment_id || !trial.railway_service_id || !trial.railway_account_pool_id) {
    throw new Error(`Trial ${trialId} is "provisioning" but missing Railway identifiers`);
  }

  const apiToken = await getPoolAccountToken(trial.railway_account_pool_id);
  const target: ProvisionedService = {
    projectId: trial.railway_project_id,
    environmentId: trial.railway_environment_id,
    serviceId: trial.railway_service_id,
  };

  const deployment = await latestDeploymentStatus(apiToken, target);
  if (!deployment) return { status: "QUEUED", done: false };

  if (!isTerminalDeploymentStatus(deployment.status)) {
    await updateTrial(trial.id, { last_deploy_status: deployment.status });
    return { status: deployment.status, done: false };
  }

  if (deployment.status === "SUCCESS") {
    await updateTrial(trial.id, {
      status: "active",
      last_deploy_status: "SUCCESS",
      expires_at: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    await logTrialEvent(trial.id, "provision_succeeded", {});
  } else {
    await releasePoolAccount(trial.railway_account_pool_id);
    await updateTrial(trial.id, { status: "failed", last_deploy_status: deployment.status });
    await logTrialEvent(trial.id, "provision_failed", { stage: "build", status: deployment.status });
  }

  return { status: deployment.status, done: true };
}
