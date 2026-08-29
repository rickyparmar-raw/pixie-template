"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 4000;

export function DeployingStep({ initialStatus }: { initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/trials/status", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data.status) setStatus(data.status);
        if (data.done) {
          router.refresh();
          return;
        }
      } catch {
        // transient — the next tick tries again
      }
      if (!cancelled) setTimeout(poll, POLL_MS);
    }

    const timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="font-heading text-xs uppercase tracking-[0.2em] text-brand">
        deploying
      </p>
      <h1 className="font-heading mt-3 text-2xl text-text">Building your bot…</h1>
      <p className="mt-3 text-sm text-text-muted">
        Current status: <span className="text-text">{status}</span>
      </p>
      <p className="mt-6 text-xs text-text-muted">
        This page updates on its own — no need to refresh. A build usually takes a couple
        of minutes.
      </p>
    </main>
  );
}
