"use client";

import { useActionState } from "react";
import { saveLlmKey, type ActionState } from "@/app/wizard/actions";
import { StepShell } from "./StepShell";
import { SubmitButton } from "./SubmitButton";
import { inputClass, labelClass } from "./formStyles";

const initialState: ActionState = { error: null };

export function LlmKeyStep() {
  const [state, formAction] = useActionState(saveLlmKey, initialState);

  return (
    <StepShell
      step={2}
      title="Add your HCAI key"
      subtitle="Each bot uses one HCAI key, so its model access stays separate."
    >
      <form action={formAction} className="space-y-5">
        <div>
          <label htmlFor="apiKey" className={labelClass}>
            API key
          </label>
          <input
            id="apiKey"
            name="apiKey"
            type="password"
            required
            autoComplete="off"
            placeholder="Your HCAI key"
            className={inputClass}
          />
        </div>
        {state.error && (
          <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
            {state.error}
          </p>
        )}
        <SubmitButton pendingLabel="Checking the key…">Validate &amp; continue</SubmitButton>
      </form>
    </StepShell>
  );
}
