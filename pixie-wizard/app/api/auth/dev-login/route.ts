import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/session";

// Skips the real Hack Club Auth handshake for local dev, so the wizard is
// clickable without an HCA OAuth app / network round trip. Hard-gated on
// NODE_ENV so `next build`/`next start` (and Vercel prod) can never serve
// this — there's no env var to misconfigure into exposing it.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available in production" }, { status: 404 });
  }

  await setSessionCookie({
    hcaId: "dev-local",
    email: "dev@localhost",
    name: "Local Dev",
    slackId: null,
  });
  return NextResponse.redirect(`${process.env.BASE_URL}/wizard`);
}
