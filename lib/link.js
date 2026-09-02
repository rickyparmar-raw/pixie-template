const http = require("http");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");
const knowledge = require("./knowledge");
const log = require("./log");

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_LENGTH = 2 * 1024 * 1024; 
const MAX_TEXT_BUDGET = 6000; 

function extractUrl(text) {
  if (!text) return null;
  const unwrapped = text.replace(/<(https?:\/\/[^|>]+)(?:\|[^>]+)?>/g, "$1");
  const match = unwrapped.match(/https?:\/\/[^\s>]+/i);
  if (!match) return null;
  let urlStr = match[0];
  
  urlStr = urlStr.replace(/[.,;:!?)]+$/, "");
  return urlStr;
}

function isPrivateOrLoopbackIp(ip) {
  if (!ip) return false;

  
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  
  if (ip.includes(".")) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; 
    }
    const [a, b] = parts;
    if (a === 127) return true; 
    if (a === 10) return true; 
    if (a === 172 && b >= 16 && b <= 31) return true; 
    if (a === 192 && b === 168) return true; 
    if (a === 169 && b === 254) return true; 
    if (a === 0) return true; 
    return false;
  }

  
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; 
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true; 
  }

  return false;
}

async function resolveAndValidateHost(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { isBlocked: true, reason: "invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { isBlocked: true, reason: "invalid scheme" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { isBlocked: true, reason: "localhost blocked" };
  }

  
  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrLoopbackIp(hostname)) {
      return { isBlocked: true, reason: "private IP blocked" };
    }
    return { isBlocked: false, parsed, validatedIp: hostname };
  }

  
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return { isBlocked: true, reason: "DNS lookup returned no records" };
    }
    for (const record of records) {
      if (isPrivateOrLoopbackIp(record.address)) {
        return { isBlocked: true, reason: `resolved private IP ${record.address}` };
      }
    }
    return { isBlocked: false, parsed, validatedIp: records[0].address };
  } catch (e) {
    return { isBlocked: true, reason: `DNS lookup failed: ${e.message}` };
  }
}

async function isBlockedHost(urlStr) {
  const result = await resolveAndValidateHost(urlStr);
  return result.isBlocked;
}

function requestResolved(parsed, validatedIp) {
  return new Promise((resolve, reject) => {
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;
    const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;

    const options = {
      hostname: validatedIp,
      port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        Host: parsed.hostname,
        "User-Agent": "PixieBot/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9",
      },
    };

    if (isHttps) {
      options.servername = parsed.hostname;
    }

    const req = transport.request(options, (res) => {
      resolve(res);
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.end();
  });
}

async function fetchUrlContent(urlStr) {
  let currentUrl = urlStr;
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    const hostValidation = await resolveAndValidateHost(currentUrl);
    if (hostValidation.isBlocked) {
      return {
        blocked: true,
        reason: "pixie can only open public URLs — localhost on your machine isn't reachable from the bot",
      };
    }

    const { parsed, validatedIp } = hostValidation;

    try {
      const res = await requestResolved(parsed, validatedIp);

      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers["location"];
        if (!location) {
          return { error: true, message: "Redirect missing Location header" };
        }
        currentUrl = new URL(location, currentUrl).href;
        redirectCount++;
        continue;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return { error: true, message: `HTTP ${res.statusCode}` };
      }

      const contentType = res.headers["content-type"] || "";
      const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
      const isTextOrJson = contentType.includes("text/") || contentType.includes("application/json");

      if (!isHtml && !isTextOrJson) {
        return { error: true, message: "Unsupported content type" };
      }

      const contentLengthStr = res.headers["content-length"];
      if (contentLengthStr && parseInt(contentLengthStr, 10) > MAX_CONTENT_LENGTH) {
        return { error: true, message: "Content exceeds 2MB limit" };
      }

      const chunks = [];
      let totalLength = 0;

      for await (const chunk of res) {
        totalLength += chunk.length;
        if (totalLength > MAX_CONTENT_LENGTH) {
          return { error: true, message: "Content exceeds 2MB limit" };
        }
        chunks.push(chunk);
      }

      const rawText = Buffer.concat(chunks).toString("utf-8");
      let text = isHtml ? knowledge.stripHtml(rawText) : rawText;
      text = text.trim();
      if (text.length > MAX_TEXT_BUDGET) {
        text = text.slice(0, MAX_TEXT_BUDGET) + "\n...[truncated]";
      }

      return { url: currentUrl, text };
    } catch (e) {
      log.debug("link", `fetch failed for ${currentUrl}: ${e.message}`);
      return { error: true, message: e.message };
    }
  }

  return { error: true, message: "Too many redirects" };
}

module.exports = {
  extractUrl,
  isPrivateOrLoopbackIp,
  isBlockedHost,
  fetchUrlContent,
  MAX_TEXT_BUDGET,
};
