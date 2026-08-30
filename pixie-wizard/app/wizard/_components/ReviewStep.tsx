"use client";

import { useActionState } from "react";
import { deployTrial, type ActionState } from "@/app/wizard/actions";
import { SubmitButton } from "./SubmitButton";
import type { ChannelSelection, DocSource } from "@/lib/types";

const initialState: ActionState = { error: null };

export function ReviewStep({
  programName,
  botName,
  llmBaseUrl,
  llmModel,
  channels,
  sources,
}: {
  programName: string;
  botName: string;
  llmBaseUrl: string;
  llmModel: string;
  channels: ChannelSelection;
  sources: DocSource[];
}) {
  const [state, formAction] = useActionState(deployTrial, initialState);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="font-heading text-xs uppercase tracking-[0.2em] text-brand">
        review
      </p>
      <h1 className="font-heading mt-3 text-2xl text-text">Ready to deploy</h1>
      <p className="mt-2 text-sm text-text-muted">
        This is what gets deployed. You can keep adjusting doc sources afterward — this
        just kicks off the trial.
      </p>

      <dl className="mt-8 space-y-4 rounded-lg border border-line bg-panel p-6 text-sm">
        <Row label="Program">{programName}</Row>
        <Row label="Bot name">{botName}</Row>
        <Row label="LLM endpoint">
          {llmModel} @ {llmBaseUrl}
        </Row>
        <Row label="Help channel">
          {channels.helpChannel ? `#${channels.helpChannel.name}` : "—"}
        </Row>
        <Row label="FAQ channels">
          {channels.faqChannels?.length
            ? channels.faqChannels.map((c) => `#${c.name}`).join(", ")
            : "none"}
        </Row>
        <Row label="Doc sources">{sources.length} source{sources.length === 1 ? "" : "s"}</Row>
        <Row label="Trial length">14 days, then paused (kept 7 more days before deletion)</Row>
      </dl>

      <form action={formAction} className="mt-6">
        {state.error && (
          <p className="mb-4 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
            {state.error}
          </p>
        )}
        <SubmitButton pendingLabel="Starting deploy…">Deploy the trial</SubmitButton>
      </form>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text">{children}</dd>
    </div>
  );
}
