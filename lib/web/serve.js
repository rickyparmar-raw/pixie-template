

const path = require("path");
const fs = require("fs");
const log = require("../log");
const auth = require("./auth");
const api = require("./api");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

function serveFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: { "Content-Type": mime, "Cache-Control": "no-cache" },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location } });
}

function htmlResponse(html, extraHeaders = {}) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) {}
  }
}

function sseStream(req) {
  let closed = false;
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const client = {
        write(data) {
          if (!closed) controller.enqueue(encoder.encode(data));
        },
      };
      sseClients.add(client);

      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      req.signal.addEventListener("abort", () => {
        closed = true;
        sseClients.delete(client);
        try { controller.close(); } catch (_) {}
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function startLogFeed() {
  log.subscribe((kind, scope, args) => {
    broadcastSSE("log", {
      kind,
      scope,
      message: args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      time: Date.now(),
    });
  });
}

let metricTimer = null;

function startMetricTicks() {
  if (metricTimer) return;
  metricTimer = setInterval(() => {
    try {
      const pulse = api.buildPulse();
      broadcastSSE("pulse", pulse);
    } catch (_) {}
    try {
      broadcastSSE("metric", { time: Date.now() });
    } catch (_) {}
  }, 10000);
  if (metricTimer.unref) metricTimer.unref();
}

async function handleStatic(req) {
  const url = new URL(req.url);
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;

  
  if (filePath.includes("..")) return null;

  const fullPath = path.join(PUBLIC_DIR, filePath);

  
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const session = auth.requireSession(req);
      if (!session) return redirect("/login");
    }
    return serveFile(fullPath);
  }

  return null;
}

async function handleScreenshots(req) {
  const url = new URL(req.url);

  
  if (url.pathname.startsWith("/screenshots/")) {
    const screenshotPath = url.pathname.slice("/screenshots/".length);

    
    if (screenshotPath.includes("..")) return ;

    const fullPath = path.join(PUBLIC_DIR, "screenshots", screenshotPath);

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return serveFile(fullPath);
  }
  }

  return null;
}

function renderLoginPage({ error, slackUrl } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pixie Dashboard Login</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0f1015;
      color: #f4f1e8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .login-card {
      background: #171922;
      border: 1px solid rgba(244, 241, 232, 0.15);
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      text-align: center;
    }
    .login-logo {
      font-size: 2.2rem;
      font-weight: 700;
      color: #72f1b8;
      margin-bottom: 4px;
      letter-spacing: -0.5px;
    }
    .login-sub {
      font-size: 0.82rem;
      color: rgba(244, 241, 232, 0.6);
      margin-bottom: 24px;
    }
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      text-align: left;
    }
    .login-form label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: rgba(244, 241, 232, 0.7);
    }
    .login-form input {
      background: #0d0e14;
      border: 1px solid rgba(244, 241, 232, 0.2);
      border-radius: 6px;
      color: #fff;
      font-size: 0.95rem;
      padding: 10px 14px;
      outline: none;
    }
    .login-form input:focus {
      border-color: #72f1b8;
      box-shadow: 0 0 0 2px rgba(114, 241, 184, 0.2);
    }
    .btn-login {
      background: #72f1b8;
      color: #0d0e14;
      font-weight: 700;
      font-size: 0.95rem;
      border: none;
      border-radius: 6px;
      padding: 12px;
      cursor: pointer;
      margin-top: 6px;
      transition: background 0.15s ease;
    }
    .btn-login:hover {
      background: #8affcc;
    }
    .login-divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
      color: rgba(244, 241, 232, 0.3);
      font-size: 0.75rem;
    }
    .login-divider::before, .login-divider::after {
      content: "";
      flex: 1;
      border-bottom: 1px solid rgba(244, 241, 232, 0.15);
    }
    .login-divider span {
      padding: 0 10px;
    }
    .btn-slack {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #2b2d3a;
      color: #f4f1e8;
      border: 1px solid rgba(244, 241, 232, 0.2);
      border-radius: 6px;
      padding: 10px;
      font-size: 0.85rem;
      text-decoration: none;
      transition: background 0.15s ease;
    }
    .btn-slack:hover {
      background: #36394a;
    }
    .login-error {
      background: rgba(254, 83, 114, 0.15);
      border: 1px solid rgba(254, 83, 114, 0.3);
      color: #fe5372;
      border-radius: 6px;
      padding: 10px;
      font-size: 0.8rem;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="login-logo">🧚 PIXIE</div>
    <div class="login-sub">Control Center & Live Analytics</div>

    ${error ? `<div class="login-error">${error}</div>` : ""}

    <form class="login-form" method="POST" action="/login">
      <label for="passcode">Dashboard Passcode</label>
      <input type="password" id="passcode" name="passcode" placeholder="Enter passcode..." autofocus required>
      <button type="submit" class="btn-login">Enter Control Room →</button>
    </form>

    ${slackUrl ? `
      <div class="login-divider"><span>OR</span></div>
      <a href="${slackUrl}" class="btn-slack">
        <svg width="16" height="16" viewBox="0 0 122.8 122.8"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/></svg>
        Sign in with Slack
      </a>
    ` : ""}
  </div>
</body>
</html>`;
}

async function handleAuth(req) {
  const url = new URL(req.url);

  if (url.pathname === "/login") {
    
    if (process.env.SLACK_CLIENT_ID === "dev-testing") {
      const cookieValue = auth.signSession("dev-user", "Developer", "admin");
      const setCookie = `${auth.COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
      return new Response(null, { status: 302, headers: { "Set-Cookie": setCookie, Location: "/" } });
    }

    if (req.method === "POST") {
      try {
        const formData = await req.formData();
        const passcode = formData.get("passcode");
        const expected = process.env.PIXIE_DASHBOARD_PASSCODE || "pixie";
        if (passcode && passcode.trim() === expected.trim()) {
          const cookieValue = auth.signSession("admin", "Admin", "admin");
          const setCookie = `${auth.COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
          return new Response(null, { status: 302, headers: { "Set-Cookie": setCookie, Location: "/" } });
        }
        const slackUrl = auth.loginUrl("/");
        return htmlResponse(renderLoginPage({ error: "Invalid passcode. Try again.", slackUrl }));
      } catch (err) {
        return htmlResponse(renderLoginPage({ error: "Login failed." }));
      }
    }

    const slackUrl = auth.loginUrl("/");
    return htmlResponse(renderLoginPage({ slackUrl }));
  }

  if (url.pathname === "/auth/callback") {
    const result = await auth.handleCallback(req);
    if (result.headers) {
      return new Response(null, { status: result.status, headers: result.headers });
    }
    return json(result.body, result.status);
  }

  if (url.pathname === "/auth/logout") {
    const result = auth.handleLogout();
    return new Response(null, { status: result.status, headers: result.headers });
  }

  return null;
}

async function handleApi(req) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  
  const adminResult = auth.requireAdmin(req);

  
  if (url.pathname === "/api/pulse" && method === "GET") {
    const session = auth.requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    return json(api.buildPulse());
  }

  
  if (url.pathname === "/api/stream" && method === "GET") {
    const session = auth.requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    return sseStream(req);
  }

  
  if (url.pathname === "/api/ask" && method === "POST") {
    const session = auth.requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const result = await api.handleAsk(body.question || "");
    return json(result);
  }

  
  if (url.pathname === "/api/queue" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.queueList());
  }

  if (url.pathname.startsWith("/api/queue/") && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const parts = url.pathname.split("/");
    const id = Number(parts[3]);
    const action = parts[4];
    if (action === "approve") api.queueApprove(id);
    else if (action === "drop") api.queueDrop(id);
    return json({ ok: true });
  }

  if (url.pathname.startsWith("/api/queue/") && method === "PATCH") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const id = Number(url.pathname.split("/")[3]);
    const body = await req.json().catch(() => ({}));
    api.queueEdit(id, body.question, body.answer);
    return json({ ok: true });
  }

  
  if (url.pathname === "/api/gaps" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.gapsList());
  }

  if (url.pathname.startsWith("/api/gaps/") && method === "PATCH") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const parts = url.pathname.split("/");
    const id = Number(parts[3]);
    const body = await req.json().catch(() => ({}));
    api.gapsMove(id, body.kind);
    return json({ ok: true });
  }

  if (url.pathname.startsWith("/api/gaps/") && url.pathname.endsWith("/rejudge") && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const id = Number(url.pathname.split("/")[3]);
    const result = await api.gapsRejudge(id);
    return json(result);
  }

  
  if (url.pathname === "/api/silence" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.silenceList());
  }

  
  if (url.pathname === "/api/knowledge" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.knowledgeInfo());
  }

  if (url.pathname === "/api/knowledge/corpus" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.knowledgeCorpus());
  }

  if (url.pathname === "/api/knowledge/refresh" && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    await api.knowledgeRefresh();
    return json({ ok: true });
  }

  
  if (url.pathname === "/api/cache" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.cacheList());
  }

  if (url.pathname.startsWith("/api/cache/") && method === "DELETE") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const hash = url.pathname.split("/")[3];
    api.cacheBust(hash);
    return json({ ok: true });
  }

  
  if (url.pathname === "/api/teach" && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const body = await req.json().catch(() => ({}));
    api.handleTeach(body.question, body.answer, adminResult.session.userId);
    return json({ ok: true });
  }

  
  if (url.pathname === "/api/report" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const week = Number(url.searchParams.get("week") || "0");
    return json(api.reportText(week));
  }

  if (url.pathname === "/api/report/post" && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const ok = await api.reportPost();
    return json({ ok });
  }

  
  if (url.pathname === "/api/health" && method === "GET") {
    const session = auth.requireSession(req);
    if (!session) return json({ error: "unauthorized" }, 401);
    return json(api.healthCheck());
  }

  
  if (url.pathname === "/api/programs" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.programsList());
  }

  if (url.pathname === "/api/programs" && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const body = await req.json().catch(() => ({}));
    return json(api.programSave(body));
  }

  if (url.pathname.startsWith("/api/programs/") && method === "DELETE") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const id = url.pathname.split("/")[3];
    return json(api.programRemove(id));
  }

  if (url.pathname.startsWith("/api/programs/") && url.pathname.endsWith("/posture") && method === "PATCH") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const id = url.pathname.split("/")[3];
    const body = await req.json().catch(() => ({}));
    return json(api.programSetPosture(id, body.posture));
  }

  
  if (url.pathname === "/api/tickets" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const programId = url.searchParams.get("programId") || null;
    const status = url.searchParams.get("status") || null;
    return json(api.ticketsList(programId, status));
  }

  if (/^\/api\/tickets\/\d+$/.test(url.pathname) && method === "PATCH") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const id = Number(url.pathname.split("/")[3]);
    const body = await req.json().catch(() => ({}));
    if (!body.status) return json({ error: "status required" }, 400);
    return json(api.ticketUpdate(id, body.status, body.assigneeId));
  }

  
  if (url.pathname === "/api/channels" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(api.channelsList());
  }

  if (url.pathname === "/api/channels/toggle" && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const body = await req.json().catch(() => ({}));
    return json(api.channelToggle(body));
  }

  if (url.pathname === "/api/channels" && method === "POST") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const body = await req.json().catch(() => ({}));
    return json(api.channelAdd(body));
  }

  if (url.pathname.startsWith("/api/channels/") && method === "DELETE") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    const parts = url.pathname.split("/");
    const programId = parts[3];
    const channelId = parts[4];
    return json(api.channelRemove(programId, channelId));
  }

  
  if (url.pathname === "/api/slack/channels" && method === "GET") {
    if (adminResult.status) return json(adminResult.body, adminResult.status);
    return json(await api.slackChannels());
  }

  return null;
}

async function handleRequest(req) {
  const url = new URL(req.url);

  try {
    
    if (["/login", "/auth/callback", "/auth/logout"].includes(url.pathname) || url.pathname.startsWith("/auth/")) {
      const res = await handleAuth(req);
      if (res) return res;
    }

    
    if (url.pathname.startsWith("/api/")) {
      const res = await handleApi(req);
      if (res) return res;
    }

    
    if (url.pathname.startsWith("/screenshots/")) {
      const res = await handleScreenshots(req);
      if (res) return res;
    }

    
    const res = await handleStatic(req);
     if (res) return res;

    return new Response("not found", { status: 404 });
  } catch (e) {
    log.error("web", `request error: ${e.message}`);
    return json({ error: "internal error" }, 500);
  }
}

function start() {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    log.info("web", "SLACK_CLIENT_ID not set — passcode auth & screenshot serving enabled");
  }

  const port = Number(process.env.PORT) || Number(process.env.PIXIE_WEB_PORT) || 4100;

  startLogFeed();
  startMetricTicks();

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: handleRequest,
  });

  log.info("web", `console running on http://0.0.0.0:${port}`);
  return server;
}

module.exports = { start, broadcastSSE };
