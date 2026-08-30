import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(`${process.env.BASE_URL}/`);
}
