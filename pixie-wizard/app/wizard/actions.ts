"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getOrCreateDraftTrial, getLiveTrial, updateTrial, logTrialEvent } from "@/lib/trials";
import { validateLlmKey } from "@/lib/llmValidate";
import { testBotToken, testAppToken } from "@/lib/slackApi";
import { encryptSecret } from "@/lib/crypto";
import { provisionTrial } from "@/lib/provisionTrial";
import { slugify } from "@/lib/slackManifest";
import type { DocSource } from "@/lib/types";

export interface ActionState {
  error: string | null;
}

const HCAI_BASE_URL = "https://ai.hackclub.com/proxy/v1";
const DEFAULT_HCAI_MODEL = "openrouter/free";

async function requireDraftTrial() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return { session, trial: await getOrCreateDraftTrial(session) };
}

export async function saveProgramInfo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { trial } = await requireDraftTrial();

  const programName = String(formData.get("programName") ?? "").trim();
  const programDescription = String(formData.get("programDescription") ?? "").trim();

  if (!programName) return { error: "Program name is required." };
  if (programName.length > 80) return { error: "Keep the program name under 80 characters." };

  await updateTrial(trial.id, {
    program_name: programName,
    program_description: programDescription || null,
  });
  await logTrialEvent(trial.id, "program_info_saved", { programName });

  revalidatePath("/wizard");
  return { error: null };
}

export async function saveLlmKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trial } = await requireDraftTrial();

  const baseUrl = HCAI_BASE_URL;
  const model = String(formData.get("model") ?? "").trim() || DEFAULT_HCAI_MODEL;
  const apiKey = String(formData.get("apiKey") ?? "").trim();

  if (!apiKey) return { error: "Paste an API key." };

  let baseUrlParsed: URL;
  try {
    baseUrlParsed = new URL(baseUrl);
  } catch {
    return { error: "That base URL doesn't look valid." };
  }
  if (baseUrlParsed.protocol !== "https:") return { error: "Base URL must be https." };

  const check = await validateLlmKey({ baseUrl, apiKey, model });
  if (!check.ok) return { error: check.error };

  await updateTrial(trial.id, {
    llm_base_url: baseUrl,
    llm_model: model,
    llm_key_encrypted: encryptSecret(apiKey),
  });
  await logTrialEvent(trial.id, "llm_key_saved", { baseUrl, model });

  revalidatePath("/wizard");
  return { error: null };
}

const SOURCE_TYPES = new Set(["url", "json-faq", "gdoc"]);

export async function saveSources(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trial } = await requireDraftTrial();

  const types = formData.getAll("sourceType").map(String);
  const urls = formData.getAll("sourceUrl").map(String);
  const labels = formData.getAll("sourceLabel").map(String);

  const sources: DocSource[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]?.trim();
    const type = types[i]?.trim();
    if (!url && !type) continue;
    if (!url) return { error: `Row ${i + 1} is missing a URL.` };
    if (!type || !SOURCE_TYPES.has(type)) return { error: `Row ${i + 1} has an invalid type.` };
    try {
      new URL(url);
    } catch {
      return { error: `Row ${i + 1}'s URL doesn't look valid.` };
    }
    sources.push({ type: type as DocSource["type"], url, label: labels[i]?.trim() || undefined });
  }

  if (sources.length === 0) return { error: "Add at least one doc source." };

  await updateTrial(trial.id, { sources, status: "awaiting_slack_credentials" });
  await logTrialEvent(trial.id, "sources_saved", { count: sources.length });

  revalidatePath("/wizard");
  return { error: null };
}

export async function saveSlackCredentials(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const trial = await getLiveTrial(session.hcaId);
  if (!trial || trial.status !== "awaiting_slack_credentials") throw new Error("No trial awaiting Slack credentials");

  const botName = String(formData.get("botName") ?? "").trim();
  const botToken = String(formData.get("botToken") ?? "").trim();
  const appToken = String(formData.get("appToken") ?? "").trim();

  if (!botName) return { error: "Give the bot a display name." };
  if (!botToken || !appToken) return { error: "Paste both tokens." };

  // The slug the manifest was generated from. Slugified again server-side rather
  // than trusted: it becomes this bot's slash command names and its program id, so
  // a hand-crafted form post must not be able to put a space or a slash in either.
  const botSlug = slugify(String(formData.get("botSlug") ?? "") || botName);

  const [botCheck, appCheck] = await Promise.all([testBotToken(botToken), testAppToken(appToken)]);
  if (!botCheck.ok) return { error: `Bot token: ${botCheck.error}` };
  if (!appCheck.ok) return { error: `App-level token: ${appCheck.error}` };

  await updateTrial(trial.id, {
    bot_name: botName,
    bot_slug: botSlug,
    slack_bot_token_encrypted: encryptSecret(botToken),
    slack_app_token_encrypted: encryptSecret(appToken),
    slack_workspace_id: botCheck.teamId,
    slack_workspace_name: botCheck.teamName,
    slack_bot_user_id: botCheck.botUserId,
  });
  await logTrialEvent(trial.id, "slack_credentials_saved", { teamId: botCheck.teamId, botSlug });

  revalidatePath("/wizard");
  return { error: null };
}

export async function saveChannels(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const trial = await getLiveTrial(session.hcaId);
  if (!trial || trial.status !== "awaiting_slack_credentials") throw new Error("No trial awaiting a channel pick");

  const helpChannelId = String(formData.get("helpChannelId") ?? "").trim();
  const helpChannelName = String(formData.get("helpChannelName") ?? "").trim();
  const faqIds = formData.getAll("faqChannelId").map(String);
  const faqNames = formData.getAll("faqChannelName").map(String);

  if (!helpChannelId) return { error: "Pick or paste a help channel." };

  const faqChannels = faqIds
    .map((id, i) => ({ id: id.trim(), name: faqNames[i]?.trim() ?? "" }))
    .filter((c) => c.id);

  await updateTrial(trial.id, {
    channels: {
      helpChannel: { id: helpChannelId, name: helpChannelName || helpChannelId },
      faqChannels,
    },
  });
  await logTrialEvent(trial.id, "channels_saved", { helpChannelId, faqCount: faqChannels.length });

  revalidatePath("/wizard");
  return { error: null };
}

export async function deployTrial(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const trial = await getLiveTrial(session.hcaId);
  if (!trial || trial.status !== "awaiting_slack_credentials") throw new Error("No trial ready to deploy");
  if (!trial.channels?.helpChannel) return { error: "Pick a help channel first." };

  try {
    await provisionTrial(trial.id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Deploy failed to start." };
  }

  revalidatePath("/wizard");
  return { error: null };
}

export async function updateDashboardSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const trial = await getLiveTrial(session.hcaId);
  if (!trial) return { error: "No active trial found" };

  const posture = String(formData.get("posture") ?? "passive") as "active" | "passive" | "muted";
  const enableTickets = formData.get("enableTickets") === "on" || formData.get("enableTickets") === "true";
  const ticketChannel = String(formData.get("ticketChannel") ?? "").trim();
  const helpChannelId = String(formData.get("helpChannelId") ?? "").trim();
  const helpChannelName = String(formData.get("helpChannelName") ?? "").trim();

  await updateTrial(trial.id, {
    posture,
    enable_tickets: enableTickets,
    ticket_channel: ticketChannel || null,
    ...(helpChannelId ? {
      channels: {
        ...trial.channels,
        helpChannel: { id: helpChannelId, name: helpChannelName || helpChannelId },
      }
    } : {}),
  });

  await logTrialEvent(trial.id, "dashboard_settings_updated", { posture, enableTickets, ticketChannel });
  revalidatePath("/wizard");
  return { error: null };
}

export async function updateDashboardSources(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const trial = await getLiveTrial(session.hcaId);
  if (!trial) return { error: "No active trial found" };

  const types = formData.getAll("sourceType").map(String);
  const urls = formData.getAll("sourceUrl").map(String);
  const labels = formData.getAll("sourceLabel").map(String);

  const sources: DocSource[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]?.trim();
    const type = types[i]?.trim();
    if (!url || !type) continue;
    sources.push({ type: type as DocSource["type"], url, label: labels[i]?.trim() || undefined });
  }

  if (sources.length === 0) return { error: "At least one doc source is required." };

  await updateTrial(trial.id, { sources });
  await logTrialEvent(trial.id, "dashboard_sources_updated", { count: sources.length });
  revalidatePath("/wizard");
  return { error: null };
}
