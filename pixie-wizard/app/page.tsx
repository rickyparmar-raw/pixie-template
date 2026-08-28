export default function LandingPage() {
  const devBypass = process.env.NODE_ENV !== "production";
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="grid gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <div>
          <p className="font-heading text-xs uppercase tracking-[0.2em] text-brand">
            hack club · pixie
          </p>
          <h1 className="font-heading mt-4 text-4xl leading-[1.05] text-text sm:text-5xl">
            Get your own docs bot,
            <br />
            running in Slack today.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-text-muted">
            Pixie answers questions from your program&apos;s docs, right in your
            Slack channels. This wizard walks you through a free 14-day trial —
            your own bot identity, your own docs, your own LLM key. No code.
          </p>
          <ol className="mt-8 space-y-2 text-sm text-text-muted">
            {[
              "Sign in with Hack Club Auth",
              "Tell us about your program and paste an LLM key",
              "Point it at your docs",
              "Create a Slack app from a generated manifest",
              "We deploy it — answering in your channels within minutes",
            ].map((step, i) => (
              <li key={step} className="flex items-baseline gap-3">
                <span className="font-heading text-xs text-brand">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-lg border border-line bg-panel p-6">
          <div className="flex items-center gap-2 border-b border-line pb-4">
            <span className="h-2.5 w-2.5 rounded-full bg-brand" />
            <span className="h-2.5 w-2.5 rounded-full bg-tang" />
            <span className="h-2.5 w-2.5 rounded-full bg-mint" />
            <span className="font-heading ml-2 text-xs text-text-muted">
              #your-program-help
            </span>
          </div>
          <div className="space-y-3 py-5 text-sm">
            <p className="text-text-muted">
              <span className="text-text">someone</span> how do i connect
              hackatime to my project
            </p>
            <p className="rounded-md border border-line bg-panel-2 p-3 text-text">
              Run <code className="text-mint">hackatime install</code> then link
              it from your dashboard settings — full steps in the setup guide.
            </p>
          </div>
          <a
            href="/api/auth/login"
            className="mt-2 flex w-full items-center justify-center rounded-md bg-brand px-4 py-3 font-heading text-sm text-white transition-colors hover:bg-brand-dim"
          >
            Start your trial →
          </a>
          <p className="mt-3 text-center text-xs text-text-muted">
            Free for 14 days. Bring your own LLM key.
          </p>
          {devBypass && (
            <a
              href="/api/auth/dev-login"
              className="mt-3 flex w-full items-center justify-center rounded-md border border-line px-4 py-2 font-heading text-xs text-text-muted transition-colors hover:text-text"
            >
              Dev: skip Hack Club Auth →
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
