"use client";

import { useActionState, useState } from "react";
import { saveChannels, type ActionState } from "@/app/wizard/actions";
import { SubmitButton } from "./SubmitButton";
import { inputClass, labelClass } from "./formStyles";
import type { ChannelRef } from "@/lib/types";

const initialState: ActionState = { error: null };

export function ChannelPickerStep({
  channels,
  listError,
}: {
  channels: ChannelRef[];
  listError: string | null;
}) {
  const [state, formAction] = useActionState(saveChannels, initialState);
  const [helpManual, setHelpManual] = useState(channels.length === 0);
  const [helpId, setHelpId] = useState("");
  const [helpName, setHelpName] = useState("");
  const [faqSelected, setFaqSelected] = useState<ChannelRef[]>([]);

  function toggleFaq(channel: ChannelRef) {
    setFaqSelected((cur) =>
      cur.some((c) => c.id === channel.id)
        ? cur.filter((c) => c.id !== channel.id)
        : [...cur, channel],
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="font-heading text-xs uppercase tracking-[0.2em] text-brand">
        step 5 of 5
      </p>
      <h1 className="font-heading mt-3 text-2xl text-text">Which channels?</h1>
      <p className="mt-2 text-sm text-text-muted">
        The bot needs to self-join public channels once deployed. Private channels need a
        manual invite afterward — pixie can&apos;t see them until then, so paste the ID.
      </p>

      {listError && (
        <p className="mt-4 rounded-md border border-tang/40 bg-tang/10 px-3 py-2 text-sm text-tang">
          Couldn&apos;t list channels automatically ({listError}) — paste channel IDs
          manually below.
        </p>
      )}

      <form action={formAction} className="mt-6 space-y-6 rounded-lg border border-line bg-panel p-6">
        <div>
          <p className={labelClass}>Help channel (required)</p>
          {!helpManual && channels.length > 0 ? (
            <>
              <select
                className={inputClass}
                defaultValue=""
                onChange={(e) => {
                  const c = channels.find((ch) => ch.id === e.target.value);
                  setHelpId(c?.id ?? "");
                  setHelpName(c?.name ?? "");
                }}
              >
                <option value="" disabled>
                  Select a channel
                </option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setHelpManual(true)}
                className="mt-2 text-xs text-text-muted underline hover:text-brand"
              >
                Can&apos;t find it? Paste a channel ID instead
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <input
                placeholder="Channel ID (C0123456)"
                value={helpId}
                onChange={(e) => setHelpId(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Name (optional)"
                value={helpName}
                onChange={(e) => setHelpName(e.target.value)}
                className={inputClass}
              />
            </div>
          )}
          <input type="hidden" name="helpChannelId" value={helpId} />
          <input type="hidden" name="helpChannelName" value={helpName} />
        </div>

        {channels.length > 0 && (
          <div>
            <p className={labelClass}>FAQ / auto-reply channels (optional)</p>
            <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-line p-2">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-text hover:bg-panel-2">
                  <input
                    type="checkbox"
                    checked={faqSelected.some((f) => f.id === c.id)}
                    onChange={() => toggleFaq(c)}
                  />
                  #{c.name}
                </label>
              ))}
            </div>
            {faqSelected.map((c) => (
              <div key={c.id}>
                <input type="hidden" name="faqChannelId" value={c.id} />
                <input type="hidden" name="faqChannelName" value={c.name} />
              </div>
            ))}
          </div>
        )}

        {state.error && (
          <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
            {state.error}
          </p>
        )}
        <SubmitButton>Continue</SubmitButton>
      </form>
    </main>
  );
}
