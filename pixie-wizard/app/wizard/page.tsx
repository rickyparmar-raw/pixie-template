import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getOrCreateDraftTrial, stepForTrial } from "@/lib/trials";
import { decryptSecret } from "@/lib/crypto";
import { listPublicChannels } from "@/lib/slackApi";
import { ProgramInfoStep } from "./_components/ProgramInfoStep";
import { LlmKeyStep } from "./_components/LlmKeyStep";
import { SourcesStep } from "./_components/SourcesStep";
import { SlackHandshakeStep } from "./_components/SlackHandshakeStep";
import { ChannelPickerStep } from "./_components/ChannelPickerStep";
import { ReviewStep } from "./_components/ReviewStep";
import { DeployingStep } from "./_components/DeployingStep";
import { SettingsView } from "./_components/SettingsView";

const HCAI_BASE_URL = "https://ai.hackclub.com/proxy/v1";
const DEFAULT_HCAI_MODEL = "openrouter/free";

export default async function WizardPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const trial = await getOrCreateDraftTrial(session);

  if (trial.status === "provisioning") {
    return <DeployingStep initialStatus={trial.last_deploy_status ?? "QUEUED"} />;
  }

  if (trial.status === "active" || trial.status === "paused" || trial.status === "failed") {
    return <SettingsView trial={trial} />;
  }

  if (trial.status === "awaiting_slack_credentials") {
    if (!trial.slack_bot_token_encrypted) {
      return (
        <SlackHandshakeStep
          programName={trial.program_name}
          defaultBotName={trial.bot_name || trial.program_name}
          defaultBotSlug={trial.bot_slug ?? undefined}
        />
      );
    }

    if (!trial.channels?.helpChannel) {
      let channels: { id: string; name: string }[] = [];
      let listError: string | null = null;
      try {
        channels = await listPublicChannels(decryptSecret(trial.slack_bot_token_encrypted));
      } catch (err) {
        listError = err instanceof Error ? err.message : "unknown error";
      }
      return <ChannelPickerStep channels={channels} listError={listError} />;
    }

    return (
      <ReviewStep
        programName={trial.program_name}
        botName={trial.bot_name || trial.program_name}
        llmBaseUrl={HCAI_BASE_URL}
        llmModel={trial.llm_model || DEFAULT_HCAI_MODEL}
        channels={trial.channels}
        sources={trial.sources}
      />
    );
  }

  if (trial.status !== "draft") {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <p className="font-heading text-xs uppercase tracking-[0.2em] text-brand">
          {trial.program_name}
        </p>
        <h1 className="font-heading mt-3 text-2xl text-text">
          Your trial is at the &quot;{trial.status.replace(/_/g, " ")}&quot; stage.
        </h1>
      </main>
    );
  }

  const step = stepForTrial(trial);

  if (step === 1) return <ProgramInfoStep />;
  if (step === 2) return <LlmKeyStep />;
  if (step === 3) return <SourcesStep />;

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="font-heading text-xs uppercase tracking-[0.2em] text-mint">
        steps 1-3 done
      </p>
      <h1 className="font-heading mt-3 text-2xl text-text">
        Next up: connect a Slack app.
      </h1>
      <p className="mt-3 text-sm text-text-muted">Refresh in a moment.</p>
      <a href="/api/auth/logout" className="mt-8 inline-block text-sm text-text-muted underline">
        Sign out
      </a>
    </main>
  );
}
