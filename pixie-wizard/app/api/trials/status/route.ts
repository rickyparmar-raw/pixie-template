import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getLiveTrial } from "@/lib/trials";
import { checkTrialDeployStatus } from "@/lib/provisionTrial";

export const dynamic = "force-dynamic";

// Polled from DeployingStep every few seconds — deliberately cheap, not a
// long-lived connection, since Railway builds can run well past what a
// single request should block on. See provisionTrial.ts's own note on this.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const trial = await getLiveTrial(session.hcaId);
  if (!trial) return NextResponse.json({ ok: false, error: "no live trial" }, { status: 404 });

  if (trial.status !== "provisioning") {
    return NextResponse.json({ ok: true, status: trial.status, done: true });
  }

  const result = await checkTrialDeployStatus(trial.id);
  return NextResponse.json({ ok: true, ...result });
}
