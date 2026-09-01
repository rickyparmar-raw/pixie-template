import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Created on first use, not at import time — Next evaluates this module while
// prerendering static pages where env vars may be absent.
let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  _client ??= createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_KEY"),
    { auth: { persistSession: false } },
  );
  return _client;
}

export const db: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = client();
    const value = c[prop as keyof SupabaseClient];
    return typeof value === "function" ? (value as Function).bind(c) : value;
  },
});
