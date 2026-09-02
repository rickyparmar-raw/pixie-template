import { db } from "@/lib/supabase";
import type { PixieTrialRow, DocSource } from "@/lib/types";
import type { WizardSession } from "@/lib/session";

const LIVE_STATUSES = ["draft", "awaiting_slack_credentials", "provisioning", "active"];

// In-memory store for local development when Supabase is not reachable
const devTrialsMap = new Map<string, PixieTrialRow>();

function createDevTrial(session: WizardSession): PixieTrialRow {
  const trial: PixieTrialRow = {
    id: `dev-trial-${session.hcaId}`,
    requester_hca_id: session.hcaId,
    requester_email: session.email,
    requester_name: session.name,
    requester_slack_id: session.slackId,
    program_name: "",
    program_description: null,
    bot_name: null,
    status: "draft",
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
    created_at: new Date().toISOString(),
    expires_at: null,
    last_deploy_at: null,
    last_deploy_status: null,
    expiry_notified_at: null,
    paused_at: null,
    reclaim_deadline: null,
    deleted_at: null,
  };
  devTrialsMap.set(session.hcaId, trial);
  return trial;
}

export async function getLiveTrial(hcaId: string): Promise<PixieTrialRow | null> {
  try {
    const { data, error } = await db
      .from("pixie_trials")
      .select("*")
      .eq("requester_hca_id", hcaId)
      .in("status", LIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as PixieTrialRow | null;
  } catch (e) {
    return devTrialsMap.get(hcaId) || null;
  }
}

// Get-or-create is racy across two concurrent first page loads — the partial
// unique index in supabase/schema.sql is the real guard. A losing insert here
// just means someone else's row won; re-select and use that one.
export async function getOrCreateDraftTrial(session: WizardSession): Promise<PixieTrialRow> {
  try {
    const existing = await getLiveTrial(session.hcaId);
    if (existing) return existing;

    const { data, error } = await db
      .from("pixie_trials")
      .insert({
        requester_hca_id: session.hcaId,
        requester_email: session.email,
        requester_name: session.name,
        requester_slack_id: session.slackId,
        status: "draft",
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        const row = await getLiveTrial(session.hcaId);
        if (row) return row;
      }
      throw new Error(error.message);
    }
    return data as PixieTrialRow;
  } catch (e) {
    if (devTrialsMap.has(session.hcaId)) return devTrialsMap.get(session.hcaId)!;
    return createDevTrial(session);
  }
}

export async function getTrialById(id: string): Promise<PixieTrialRow | null> {
  try {
    const { data, error } = await db.from("pixie_trials").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as PixieTrialRow | null;
  } catch (e) {
    for (const t of devTrialsMap.values()) {
      if (t.id === id) return t;
    }
    return null;
  }
}

export async function updateTrial(
  id: string,
  patch: Partial<PixieTrialRow>,
): Promise<PixieTrialRow> {
  try {
    const { data, error } = await db
      .from("pixie_trials")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as PixieTrialRow;
  } catch (e) {
    for (const [key, t] of devTrialsMap.entries()) {
      if (t.id === id) {
        const updated = { ...t, ...patch };
        devTrialsMap.set(key, updated);
        return updated;
      }
    }
    throw new Error(`updateTrial dev error: trial ${id} not found`);
  }
}

export async function logTrialEvent(
  trialId: string,
  eventType: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .from("trial_events")
      .insert({ trial_id: trialId, event_type: eventType, detail: detail ?? null });
  } catch (e) {
    // dev mode silent log
  }
}

// The three buckets app/api/cron/sweep-trials/route.ts sweeps, per plan §4.

export async function findExpiredActiveTrials(now: Date): Promise<PixieTrialRow[]> {
  const { data, error } = await db
    .from("pixie_trials")
    .select("*")
    .eq("status", "active")
    .lt("expires_at", now.toISOString());
  if (error) throw new Error(`findExpiredActiveTrials: ${error.message}`);
  return (data as PixieTrialRow[]) ?? [];
}

export async function findReclaimableTrials(now: Date): Promise<PixieTrialRow[]> {
  const { data, error } = await db
    .from("pixie_trials")
    .select("*")
    .eq("status", "paused")
    .lt("reclaim_deadline", now.toISOString());
  if (error) throw new Error(`findReclaimableTrials: ${error.message}`);
  return (data as PixieTrialRow[]) ?? [];
}

export async function findTrialsNeedingExpiryWarning(now: Date, warningWindowMs: number): Promise<PixieTrialRow[]> {
  const soon = new Date(now.getTime() + warningWindowMs).toISOString();
  const { data, error } = await db
    .from("pixie_trials")
    .select("*")
    .eq("status", "active")
    .is("expiry_notified_at", null)
    .not("expires_at", "is", null)
    .lte("expires_at", soon)
    .gt("expires_at", now.toISOString());
  if (error) throw new Error(`findTrialsNeedingExpiryWarning: ${error.message}`);
  return (data as PixieTrialRow[]) ?? [];
}

// Steps 1-3 all happen while status is still "draft" — there's no separate
// step counter column, so progress is read off which fields are already
// filled. Step 4 (Slack manifest handshake, task #18) is the first thing that
// actually advances status away from "draft".
export type WizardStep = 1 | 2 | 3 | "awaiting-slack";

export function stepForTrial(trial: PixieTrialRow): WizardStep {
  if (!trial.program_name) return 1;
  if (!trial.llm_key_encrypted) return 2;
  if (!trial.sources || (trial.sources as DocSource[]).length === 0) return 3;
  return "awaiting-slack";
}
