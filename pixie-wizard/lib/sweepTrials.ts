import {
  findExpiredActiveTrials,
  findReclaimableTrials,
  findTrialsNeedingExpiryWarning,
  updateTrial,
  logTrialEvent,
} from "@/lib/trials";
import { getPoolAccountToken, releasePoolAccount } from "@/lib/railwayPool";
import { pauseService, deleteProject, type ProvisionedService } from "@/lib/railway";
import { notifyTrial } from "@/lib/notify";
import type { PixieTrialRow } from "@/lib/types";

const RECLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface SweepResult {
  paused: number;
  deleted: number;
  warned: number;
  errors: string[];
}

function railwayTarget(trial: PixieTrialRow): ProvisionedService | null {
  if (!trial.railway_project_id || !trial.railway_environment_id || !trial.railway_service_id) return null;
  return {
    projectId: trial.railway_project_id,
    environmentId: trial.railway_environment_id,
    serviceId: trial.railway_service_id,
  };
}

// Per plan §4: pause (not delete) at expiry, with a 7-day reclaim window
// before hard delete. One bug in the sweep or one slow-to-react owner
// shouldn't be able to destroy a trial's data outright.
async function pauseExpiredTrials(now: Date, result: SweepResult): Promise<void> {
  const trials = await findExpiredActiveTrials(now);
  for (const trial of trials) {
    try {
      const target = railwayTarget(trial);
      if (target && trial.railway_account_pool_id) {
        const token = await getPoolAccountToken(trial.railway_account_pool_id);
        await pauseService(token, target);
      }
      await updateTrial(trial.id, {
        status: "paused",
        paused_at: now.toISOString(),
        reclaim_deadline: new Date(now.getTime() + RECLAIM_WINDOW_MS).toISOString(),
      });
      await logTrialEvent(trial.id, "trial_paused", { reason: "expired" });
      await notifyTrial(
        trial,
        "Your pixie trial has ended",
        `Your 14-day trial for ${trial.program_name} has ended and the bot is now paused. It'll be kept for 7 more days in case you want to extend it — just reach out.`,
      );
      result.paused++;
    } catch (err) {
      result.errors.push(`pause ${trial.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function deleteReclaimedTrials(now: Date, result: SweepResult): Promise<void> {
  const trials = await findReclaimableTrials(now);
  for (const trial of trials) {
    try {
      const target = railwayTarget(trial);
      if (target && trial.railway_account_pool_id) {
        const token = await getPoolAccountToken(trial.railway_account_pool_id);
        await deleteProject(token, target.projectId);
        await releasePoolAccount(trial.railway_account_pool_id);
      }
      await updateTrial(trial.id, {
        status: "deleted",
        deleted_at: now.toISOString(),
        llm_key_encrypted: null,
        slack_bot_token_encrypted: null,
        slack_app_token_encrypted: null,
      });
      await logTrialEvent(trial.id, "trial_deleted", { reason: "reclaim_deadline_passed" });
      result.deleted++;
    } catch (err) {
      result.errors.push(`delete ${trial.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function warnExpiringTrials(now: Date, result: SweepResult): Promise<void> {
  const trials = await findTrialsNeedingExpiryWarning(now, EXPIRY_WARNING_WINDOW_MS);
  for (const trial of trials) {
    try {
      await notifyTrial(
        trial,
        "Your pixie trial ends soon",
        `Your trial for ${trial.program_name} ends in the next few days. Reach out if you'd like to keep it running past the trial window.`,
      );
      await updateTrial(trial.id, { expiry_notified_at: now.toISOString() });
      result.warned++;
    } catch (err) {
      result.errors.push(`warn ${trial.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

export async function sweepTrials(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { paused: 0, deleted: 0, warned: 0, errors: [] };
  await pauseExpiredTrials(now, result);
  await deleteReclaimedTrials(now, result);
  await warnExpiringTrials(now, result);
  return result;
}
