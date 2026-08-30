import { NextResponse } from "next/server";
import { sweepTrials } from "@/lib/sweepTrials";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await sweepTrials();
  return NextResponse.json({ ok: true, ...result });
}
