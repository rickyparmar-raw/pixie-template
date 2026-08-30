"use client";

import { useActionState } from "react";
import { saveProgramInfo, type ActionState } from "@/app/wizard/actions";
import { StepShell } from "./StepShell";
import { SubmitButton } from "./SubmitButton";
import { inputClass, labelClass } from "./formStyles";

const initialState: ActionState = { error: null };

export function ProgramInfoStep() {
  const [state, formAction] = useActionState(saveProgramInfo, initialState);

  return (
    <StepShell
      step={1}
      title="What's the program?"
      subtitle="This shows up in how pixie introduces itself and answers questions."
    >
      <form action={formAction} className="space-y-5">
        <div>
          <label htmlFor="programName" className={labelClass}>
            Program name
          </label>
          <input
            id="programName"
            name="programName"
            required
            maxLength={80}
            placeholder="e.g. Athena"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="programDescription" className={labelClass}>
            Short description (optional)
          </label>
          <textarea
            id="programDescription"
            name="programDescription"
            rows={3}
            placeholder="One or two sentences about what the program is"
            className={inputClass}
          />
        </div>
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
