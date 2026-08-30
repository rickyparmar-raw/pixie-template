"use client";

import { useActionState, useState } from "react";
import type { PixieTrialRow, DocSource } from "@/lib/types";
import { updateDashboardSettings, updateDashboardSources, type ActionState } from "@/app/wizard/actions";
import { SubmitButton } from "./SubmitButton";
import { inputClass, labelClass } from "./formStyles";

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  active: { label: "active", tone: "text-mint" },
  paused: { label: "paused", tone: "text-tang" },
  failed: { label: "failed", tone: "text-brand" },
  deleted: { label: "deleted", tone: "text-text-muted" },
  draft: { label: "draft mode", tone: "text-tang" },
  provisioning: { label: "provisioning", tone: "text-tang" },
};

const initialState: ActionState = { error: null };

export function SettingsView({ trial }: { trial: PixieTrialRow }) {
  const status = STATUS_COPY[trial.status] ?? { label: trial.status, tone: "text-text" };
  const [settingsState, settingsAction] = useActionState(updateDashboardSettings, initialState);
  const [sourcesState, sourcesAction] = useActionState(updateDashboardSources, initialState);

  const [sources, setSources] = useState<DocSource[]>(
    trial.sources?.length ? trial.sources : [{ type: "url", url: "" }]
  );

  const addSource = () => setSources([...sources, { type: "url", url: "" }]);
  const removeSource = (index: number) => {
    if (sources.length <= 1) return;
    setSources(sources.filter((_, i) => i !== index));
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {/* Header & Status HUD */}
      <div className="flex items-center justify-between border-b border-line pb-6">
        <div>
          <p className={`font-heading text-xs uppercase tracking-[0.2em] ${status.tone}`}>
            ● {status.label}
          </p>
          <h1 className="font-heading mt-2 text-3xl text-text">
            {trial.bot_name || trial.program_name || "YSWS Bot Control Room"}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Program: <span className="text-text font-medium">{trial.program_name || "Custom Program"}</span> · Workspace: {trial.slack_workspace_name ?? "Hack Club Workspace"}
          </p>
        </div>
        <div>
          <a href="/api/auth/logout" className="rounded-md border border-line px-3 py-2 text-xs text-text-muted hover:text-text">
            Sign out
          </a>
        </div>
      </div>

      <div className="mt-8 space-y-10">
        {/* Section 1: Bot Posture & Ticket Controls */}
        <section className="rounded-lg border border-line bg-panel p-6">
          <h2 className="font-heading text-lg text-text">Bot Behavior & Ticket Routing</h2>
          <p className="mt-1 text-xs text-text-muted">Configure how Pixie handles chat, intent classification, and helper tickets in your channels.</p>

          <form action={settingsAction} className="mt-6 space-y-6">
            {/* Posture Selector */}
            <div>
              <label className={labelClass}>Intent Classifier Mode</label>
              <div className="mt-2 grid grid-cols-3 gap-3">
                {[
                  { value: "passive", title: "Passive (Recommended)", desc: "Answers real questions, stays quiet on chat" },
                  { value: "active", title: "Active Help Desk", desc: "Replies to all top-level questions in help channel" },
                  { value: "muted", title: "Muted Mode", desc: "Only replies when explicitly pinged @Bot" },
                ].map((p) => (
                  <label key={p.value} className="cursor-pointer rounded-md border border-line bg-panel-2 p-3 transition-colors hover:border-brand">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="posture"
                        value={p.value}
                        defaultChecked={(trial.posture || "passive") === p.value}
                      />
                      <span className="font-heading text-xs text-text">{p.title}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">{p.desc}</p>
                  </label>
                ))}
              </div>
            </div>

            {/* Ticket Escalation Toggle */}
            <div className="border-t border-line pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="font-heading text-sm text-text">Enable Ticket Escalations</label>
                  <p className="text-xs text-text-muted">Create support ticket cards when Pixie cannot answer or when a human flag is raised.</p>
                </div>
                <input
                  type="checkbox"
                  name="enableTickets"
                  defaultChecked={trial.enable_tickets ?? true}
                  className="h-5 w-5 rounded border-line"
                />
              </div>

              <div className="mt-4">
                <label htmlFor="ticketChannel" className={labelClass}>Ticket Escalation Destination Channel</label>
                <input
                  id="ticketChannel"
                  name="ticketChannel"
                  defaultValue={trial.ticket_channel || trial.channels?.helpChannel?.id || ""}
                  placeholder="e.g. C0123456789 or #ysws-tickets"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Help Channel Mapping */}
            <div className="border-t border-line pt-5">
              <label htmlFor="helpChannelId" className={labelClass}>Primary Help Channel ID</label>
              <input
                id="helpChannelId"
                name="helpChannelId"
                defaultValue={trial.channels?.helpChannel?.id || ""}
                placeholder="e.g. C0A8G9BSCSG"
                className={inputClass}
              />
            </div>

            {settingsState.error && (
              <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-brand">
                {settingsState.error}
              </p>
            )}

            <SubmitButton>Save Behavior & Ticket Settings</SubmitButton>
          </form>
        </section>

        {/* Section 2: Documentation Sources Manager */}
        <section className="rounded-lg border border-line bg-panel p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-heading text-lg text-text">Documentation Sources ({sources.length})</h2>
              <p className="mt-1 text-xs text-text-muted">Manage the website URLs, GitHub markdown repos, or JSON FAQs your bot reads from.</p>
            </div>
            <button
              type="button"
              onClick={addSource}
              className="rounded-md border border-line bg-panel-2 px-3 py-1.5 font-heading text-xs text-mint hover:border-mint"
            >
              + Add Source
            </button>
          </div>

          <form action={sourcesAction} className="mt-6 space-y-4">
            {sources.map((src, i) => (
              <div key={i} className="flex gap-3 items-center rounded-md border border-line bg-panel-2 p-3">
                <select
                  name="sourceType"
                  defaultValue={src.type}
                  className="rounded-md border border-line bg-panel p-2 text-xs text-text"
                >
                  <option value="url">Website URL</option>
                  <option value="json-faq">JSON FAQ File</option>
                  <option value="gdoc">Google Doc</option>
                </select>

                <input
                  type="text"
                  name="sourceUrl"
                  defaultValue={src.url}
                  placeholder="https://docs.yourprogram.com/"
                  className={`${inputClass} flex-1`}
                  required
                />

                <input
                  type="text"
                  name="sourceLabel"
                  defaultValue={src.label || ""}
                  placeholder="Label (optional)"
                  className={`${inputClass} w-32`}
                />

                {sources.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSource(i)}
                    className="text-xs text-brand hover:underline px-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}

            {sourcesState.error && (
              <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-brand">
                {sourcesState.error}
              </p>
            )}

            <SubmitButton>Save Doc Sources & Re-index</SubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}
