import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "pixie_wizard_session";
const MAX_AGE = 60 * 60 * 24 * 7;

export interface WizardSession {
  hcaId: string;
  email: string;
  name: string;
  slackId: string | null;
  exp: number;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(session: WizardSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw: string | undefined): WizardSession | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as WizardSession;
    if (session.exp < Date.now() / 1000) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<WizardSession | null> {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE)?.value);
}

export async function setSessionCookie(session: Omit<WizardSession, "exp">) {
  const jar = await cookies();
  jar.set(
    COOKIE,
    encodeSession({ ...session, exp: Date.now() / 1000 + MAX_AGE }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.BASE_URL?.startsWith("https") ?? false,
      maxAge: MAX_AGE,
      path: "/",
    },
  );
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// Unset means open to anyone with a Hack Club Auth account — an HCA account
// is general Hack Club identity, not a vetted "runs a YSWS program" role, so
// populate this before a real launch rather than trusting HCA login alone.
export function isAllowed(identity: { hcaId: string; email: string }): boolean {
  const raw = (process.env.PIXIE_WIZARD_ALLOWLIST ?? "").trim();
  if (!raw) return true;
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const email = identity.email.toLowerCase();
  const domain = email.split("@")[1];
  return entries.some(
    (e) => e === identity.hcaId.toLowerCase() || e === email || (domain && e === domain),
  );
}
