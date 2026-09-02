import { decryptSecret } from "@/lib/crypto";
import { postDirectMessage } from "@/lib/slackApi";
import type { PixieTrialRow } from "@/lib/types";

// Best-effort email via Resend. Silently skipped when not configured, since
// the sweep should never crash a whole run over one missing env var.
async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("resend email failed", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("resend email failed", err instanceof Error ? err.message : err);
    return false;
  }
}

// Email is the guaranteed channel — always captured at HCA login (see
// app/api/auth/callback/route.ts). A DM through the trial's own bot token is
// a bonus channel on top, attempted only when the trial has both a live bot
// token and a known requester Slack id; its failure never blocks the email.
export async function notifyTrial(trial: PixieTrialRow, subject: string, body: string): Promise<void> {
  if (trial.slack_bot_token_encrypted && trial.requester_slack_id) {
    try {
      await postDirectMessage(
        decryptSecret(trial.slack_bot_token_encrypted),
        trial.requester_slack_id,
        `*${subject}*\n\n${body}`,
      );
    } catch (err) {
      console.error("trial DM failed", err instanceof Error ? err.message : err);
    }
  }
  await sendEmail(trial.requester_email, subject, body);
}
