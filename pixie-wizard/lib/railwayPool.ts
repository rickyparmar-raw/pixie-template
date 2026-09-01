import { db } from "@/lib/supabase";
import { decryptSecret } from "@/lib/crypto";
import type { RailwayAccountPoolRow } from "@/lib/types";

export class PoolExhaustedError extends Error {
  constructor() {
    super("No Railway pool account is free right now — try again shortly.");
    this.name = "PoolExhaustedError";
  }
}

export interface PoolAccount {
  id: string;
  label: string;
  apiToken: string;
}

// A failed provision is costlier than a wasted LLM retry — it can leave
// half-created cloud resources behind. Fail fast and explicitly rather than
// pixie's own "send a doomed request anyway" philosophy for an exhausted key
// pool: there is no equivalent of "try anyway and see" here.
export async function pickPoolAccount(): Promise<PoolAccount> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("railway_account_pool")
    .select("*")
    .eq("disabled", false)
    .or(`cooling_until.is.null,cooling_until.lt.${nowIso}`)
    .order("current_trial_count", { ascending: true })
    .limit(20);

  if (error) throw new Error(`pickPoolAccount: ${error.message}`);

  const rows = (data as RailwayAccountPoolRow[]) ?? [];
  const candidate = rows.find((r) => r.current_trial_count < r.max_concurrent_trials);
  if (!candidate) throw new PoolExhaustedError();

  return { id: candidate.id, label: candidate.label, apiToken: decryptSecret(candidate.api_token_encrypted) };
}

// Non-atomic read-then-write — acceptable here because trial provisioning is
// a manual, low-frequency action (not a hot path under concurrent load), not
// because the race doesn't exist. Worth an RPC-based atomic increment if this
// pool ever sees real concurrent provisioning.
export async function claimPoolAccount(accountId: string): Promise<void> {
  const { data, error } = await db
    .from("railway_account_pool")
    .select("current_trial_count")
    .eq("id", accountId)
    .single();
  if (error) throw new Error(`claimPoolAccount: ${error.message}`);

  const { error: updateError } = await db
    .from("railway_account_pool")
    .update({ current_trial_count: (data.current_trial_count as number) + 1 })
    .eq("id", accountId);
  if (updateError) throw new Error(`claimPoolAccount: ${updateError.message}`);
}

export async function releasePoolAccount(accountId: string): Promise<void> {
  const { data, error } = await db
    .from("railway_account_pool")
    .select("current_trial_count")
    .eq("id", accountId)
    .single();
  if (error) throw new Error(`releasePoolAccount: ${error.message}`);

  const { error: updateError } = await db
    .from("railway_account_pool")
    .update({ current_trial_count: Math.max(0, (data.current_trial_count as number) - 1) })
    .eq("id", accountId);
  if (updateError) throw new Error(`releasePoolAccount: ${updateError.message}`);
}

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

export async function penalizePoolAccount(accountId: string, cooldownMs = DEFAULT_COOLDOWN_MS): Promise<void> {
  const coolingUntil = new Date(Date.now() + cooldownMs).toISOString();
  const { error } = await db
    .from("railway_account_pool")
    .update({ cooling_until: coolingUntil })
    .eq("id", accountId);
  if (error) throw new Error(`penalizePoolAccount: ${error.message}`);
}

// For when a trial already owns a specific pool account (mid-provision status
// checks, lifecycle sweeps) — unlike pickPoolAccount, this doesn't filter by
// availability, it just fetches the one account's decrypted token.
export async function getPoolAccountToken(accountId: string): Promise<string> {
  const { data, error } = await db
    .from("railway_account_pool")
    .select("api_token_encrypted")
    .eq("id", accountId)
    .single();
  if (error) throw new Error(`getPoolAccountToken: ${error.message}`);
  return decryptSecret(data.api_token_encrypted as string);
}
