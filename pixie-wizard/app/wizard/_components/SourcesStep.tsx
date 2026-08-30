"use client";

import { useActionState, useRef, useState } from "react";
import { saveSources, type ActionState } from "@/app/wizard/actions";
import { StepShell } from "./StepShell";
import { SubmitButton } from "./SubmitButton";
import { inputClass, labelClass } from "./formStyles";

const initialState: ActionState = { error: null };

const TYPE_OPTIONS = [
  { value: "url", label: "Web page (scraped)" },
  { value: "json-faq", label: "FAQ JSON" },
  { value: "gdoc", label: "Google Doc" },
] as const;

export function SourcesStep() {
  const [state, formAction] = useActionState(saveSources, initialState);
  const nextRowId = useRef(1);
  const [rows, setRows] = useState(() => [0]);

  return (
    <StepShell
      step={3}
      title="Point pixie at your docs"
      subtitle="Add every page, FAQ, or doc pixie should answer questions from. You can add more later."
    >
      <form action={formAction} className="space-y-5">
        <div className="space-y-4">
          {rows.map((rowId, i) => (
            <div key={rowId} className="rounded-md border border-line p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-heading text-xs text-text-muted">
                  Source {i + 1}
                </span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((r) => r.filter((id) => id !== rowId))}
                    className="text-xs text-text-muted underline hover:text-brand"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Type</label>
                  <select name="sourceType" defaultValue="url" className={inputClass}>
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>URL</label>
                  <input
                    name="sourceUrl"
                    placeholder="https://docs.example.org/getting-started"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Label (optional)</label>
                  <input
                    name="sourceLabel"
                    placeholder="e.g. Getting started guide"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setRows((r) => [...r, nextRowId.current++])}
          className="w-full rounded-md border border-dashed border-line px-4 py-2.5 text-sm text-text-muted hover:border-brand hover:text-text"
        >
          + Add another source
        </button>

        {state.error && (
          <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
            {state.error}
          </p>
        )}
        <SubmitButton>Continue</SubmitButton>
      </form>
    </StepShell>
  );
}
