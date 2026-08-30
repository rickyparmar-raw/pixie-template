"use client";

import { useActionState, useMemo, useState } from "react";
import { saveSlackCredentials, type ActionState } from "@/app/wizard/actions";
import { generateSlackManifest, commandNamesFor, slugify } from "@/lib/slackManifest";
import { SubmitButton } from "./SubmitButton";
import { inputClass, labelClass } from "./formStyles";

const initialState: ActionState = { error: null };

export function SlackHandshakeStep({
  programName,
  defaultBotName,
  defaultBotSlug,
}: {
  programName: string;
  defaultBotName: string;
  defaultBotSlug?: string;
}) {
  const [state, formAction] = useActionState(saveSlackCredentials, initialState);
  const [botName, setBotName] = useState(defaultBotName);
  // Tracked separately from the name because it's the load-bearing field: it
  // becomes every slash command. Left blank it follows the name, which is what
  // most people want; typed into, it stops following so it isn't overwritten.
  const [slugInput, setSlugInput] = useState(defaultBotSlug ?? "");
  const [copied, setCopied] = useState(false);

  const effectiveName = botName || defaultBotName;
  const slug = slugify(slugInput || effectiveName);

  const manifest = useMemo(
    () => JSON.stringify(generateSlackManifest(effectiveName, programName, slug), null, 2),
    [effectiveName, programName, slug],
  );

  // Shown live because the naming is the single most confusing thing in this flow
  // and the cheapest to make obvious before the app is created — a slug is
  // painful to change afterwards, since every command has to be renamed by hand.
  const commands = useMemo(() => commandNamesFor(slug), [slug]);

  async function copyManifest() {
    await navigator.clipboard.writeText(manifest);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-heading text-xs uppercase tracking-[0.2em] text-brand">
        step 4 of 5
      </p>
      <h1 className="font-heading mt-3 text-2xl text-text">Create the Slack app</h1>
      <p className="mt-2 text-sm text-text-muted">
        Every trial gets its own Slack app in the same Hack Club workspace pixie already
        lives in. You&apos;ll create it yourself — Slack has no way to do this silently.
      </p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-6">
        <label htmlFor="botDisplayName" className={labelClass}>
          Bot display name
        </label>
        <input
          id="botDisplayName"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          maxLength={80}
          className={inputClass}
        />

        <label htmlFor="botSlug" className={`${labelClass} mt-5`}>
          Command prefix
        </label>
        <input
          id="botSlug"
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder={slugify(effectiveName)}
          maxLength={22}
          className={inputClass}
        />
        <p className="mt-2 text-xs text-text-muted">
          Every slash command starts with this. It has to be unique across the workspace —
          two bots can&apos;t both own <code>/{slug}</code>. Changing it after the app exists
          means renaming every command by hand, so it&apos;s worth getting right now.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {commands.map((c) => (
            <code
              key={c}
              className="rounded border border-line bg-panel-2 px-1.5 py-0.5 text-xs text-text-muted"
            >
              {c}
            </code>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <p className={labelClass}>Manifest</p>
          <button
            type="button"
            onClick={copyManifest}
            className="text-xs text-text-muted underline hover:text-brand"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="max-h-72 overflow-auto rounded-md border border-line bg-panel-2 p-3 text-xs text-text-muted">
          {manifest}
        </pre>

        <ol className="mt-5 space-y-2 text-sm text-text-muted">
          <li>
            1. Go to{" "}
            <a
              href="https://api.slack.com/apps/new"
              target="_blank"
              rel="noreferrer"
              className="text-mint underline"
            >
              api.slack.com/apps/new
            </a>{" "}
            → &quot;From an app manifest&quot; → pick the Hack Club workspace → paste the JSON
            above.
          </li>
          <li>2. Install the app to the workspace.</li>
          <li>
            3. <span className="text-text">OAuth &amp; Permissions</span> → copy the{" "}
            <span className="text-text">Bot User OAuth Token</span> (starts with{" "}
            <code>xoxb-</code>).
          </li>
          <li>
            4. <span className="text-text">Basic Information → App-Level Tokens</span> →
            generate one with the <code>connections:write</code> scope → copy it (starts
            with <code>xapp-</code>).
          </li>
        </ol>
      </div>

      <form action={formAction} className="mt-6 space-y-5 rounded-lg border border-line bg-panel p-6">
        <input type="hidden" name="botName" value={botName} />
        <input type="hidden" name="botSlug" value={slug} />
        <div>
          <label htmlFor="botToken" className={labelClass}>
            Bot token
          </label>
          <input
            id="botToken"
            name="botToken"
            type="password"
            autoComplete="off"
            placeholder="xoxb-..."
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="appToken" className={labelClass}>
            App-level token
          </label>
          <input
            id="appToken"
            name="appToken"
            type="password"
            autoComplete="off"
            placeholder="xapp-..."
            className={inputClass}
          />
        </div>
        {state.error && (
          <p className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
            {state.error}
          </p>
        )}
        <SubmitButton pendingLabel="Validating…">Continue</SubmitButton>
      </form>
    </main>
  );
}
