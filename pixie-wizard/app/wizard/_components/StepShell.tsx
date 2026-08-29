const STEPS = ["Program", "LLM key", "Docs"] as const;

export function StepShell({
  step,
  title,
  subtitle,
  children,
}: {
  step: 1 | 2 | 3;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const state = n < step ? "done" : n === step ? "active" : "todo";
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={
                  "flex h-6 w-6 items-center justify-center rounded-full font-heading text-[11px] " +
                  (state === "done"
                    ? "bg-mint text-ink"
                    : state === "active"
                      ? "bg-brand text-white"
                      : "border border-line text-text-muted")
                }
              >
                {state === "done" ? "✓" : n}
              </div>
              <span
                className={
                  "text-xs " + (state === "todo" ? "text-text-muted" : "text-text")
                }
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
            </div>
          );
        })}
      </div>

      <h1 className="font-heading text-2xl text-text">{title}</h1>
      <p className="mt-2 text-sm text-text-muted">{subtitle}</p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-6">{children}</div>
    </main>
  );
}
