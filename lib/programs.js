const fs = require("fs");
const path = require("path");
const { config } = require("./config");
const db = require("./db");
const log = require("./log");

const PROGRAMS_FILE = path.join(__dirname, "..", "programs.json");
const SOURCES_FILE = path.join(__dirname, "..", "sources.json");
const PROGRAM_FILE = path.join(__dirname, "..", "program.json");

let cachedPrograms = null;

let cachedEnvRaw = null;
let cachedEnvPrograms = null;

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function readSourcesJson() {
  return readJsonFile(SOURCES_FILE, []);
}

function readProgramJsonMilestones() {
  const data = readJsonFile(PROGRAM_FILE, {});
  return data.milestones || [];
}

function normalizeProgram(p) {
  return {
    id: p.id,
    name: p.name || p.id,
    posture: p.posture || "active",
    scope: p.scope === "program" ? "program" : "any",
    helpChannel: p.helpChannel || null,
    channels: Array.isArray(p.channels) ? p.channels : [],
    helperGroup: p.helperGroup || null,
    sources: Array.isArray(p.sources) ? p.sources : [],
    milestones: Array.isArray(p.milestones) ? p.milestones : [],
    guides: Array.isArray(p.guides) ? p.guides : [],
    links: p.links || {},
  };
}

function loadEnvPrograms() {
  const raw = (process.env.PIXIE_PROGRAMS_JSON || "").trim();
  if (!raw) return null;
  
  
  
  if (cachedEnvRaw === raw) return cachedEnvPrograms;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn("programs", `PIXIE_PROGRAMS_JSON is not valid JSON (${err.message}) — falling back to files`);
    cachedEnvRaw = raw;
    cachedEnvPrograms = null;
    return null;
  }

  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.programs) ? parsed.programs : null;
  if (!list) {
    log.warn("programs", "PIXIE_PROGRAMS_JSON must be an array or { programs: [...] } — falling back to files");
    cachedEnvRaw = raw;
    cachedEnvPrograms = null;
    return null;
  }

  
  
  const usable = list.filter((p) => p && typeof p.id === "string" && p.id.trim());
  if (usable.length !== list.length) {
    log.warn("programs", `ignored ${list.length - usable.length} program(s) in PIXIE_PROGRAMS_JSON with no id`);
  }

  cachedEnvRaw = raw;
  cachedEnvPrograms = usable.length > 0 ? usable.map(normalizeProgram) : null;
  return cachedEnvPrograms;
}

function legacyFallbackProgram() {
  const sources = readSourcesJson();
  const milestones = readProgramJsonMilestones();
  const helpChannel = config?.slack?.helpChannel || null;
  const faqChannels = config?.slack?.faqChannels || [];
  const channels = helpChannel && !faqChannels.includes(helpChannel)
    ? [helpChannel, ...faqChannels]
    : faqChannels;

  return {
    id: "pixl",
    name: "Pixl",
    posture: "active",
    scope: process.env.PIXIE_SCOPE === "any" ? "any" : "program",
    helpChannel,
    channels,
    helperGroup: null,
    sources,
    milestones,
    guides: ["submit-ysws-guidelines"],
    links: {},
  };
}

function loadFilePrograms() {
  const fileData = readJsonFile(PROGRAMS_FILE, null);
  if (!Array.isArray(fileData) || fileData.length === 0) {
    return null;
  }
  return fileData.map(normalizeProgram);
}

function loadConfiguredPrograms() {
  return loadEnvPrograms() || loadFilePrograms();
}

function all() {
  if (cachedPrograms) return cachedPrograms;

  const fileProgs = loadConfiguredPrograms();
  let dbProgs = [];
  try {
    dbProgs = db.getDbPrograms();
  } catch (_) {
    dbProgs = [];
  }

  if ((!fileProgs || fileProgs.length === 0) && dbProgs.length === 0) {
    cachedPrograms = [legacyFallbackProgram()];
    return cachedPrograms;
  }

  const map = new Map();
  if (fileProgs) {
    for (const p of fileProgs) {
      map.set(p.id, p);
    }
  }
  for (const p of dbProgs) {
    map.set(p.id, p);
  }

  cachedPrograms = Array.from(map.values());
  return cachedPrograms;
}

function invalidate() {
  cachedPrograms = null;
  cachedEnvRaw = null;
  cachedEnvPrograms = null;
}

function shared() {
  const envProgs = loadEnvPrograms();
  if (envProgs) {
    const fromEnv = envProgs.find((p) => p.id === "ysws-global");
    return fromEnv
      ? { ...fromEnv, scope: "any" }
      : {
          id: "ysws-global",
          name: "YSWS Global",
          posture: "active",
          scope: "any",
          helpChannel: null,
          channels: [],
          helperGroup: null,
          sources: [],
          milestones: [],
          guides: ["submit-ysws-guidelines"],
          links: {},
        };
  }

  return {
    id: "ysws-global",
    name: "YSWS Global",
    posture: "active",
    scope: "any",
    helpChannel: null,
    channels: [],
    helperGroup: null,
    sources: readSourcesJson(),
    milestones: readProgramJsonMilestones(),
    guides: ["submit-ysws-guidelines"],
    links: {},
  };
}

function get(id) {
  if (!id || id === "ysws-global") return shared();
  return all().find((p) => p.id === id) || null;
}

function forChannel(channelId) {
  if (!channelId) return shared();

  const progs = all();
  for (const p of progs) {
    if (p.helpChannel === channelId || (p.channels && p.channels.includes(channelId))) {
      return p;
    }
  }

  if (config?.slack?.helpChannel && channelId === config.slack.helpChannel) {
    const helpProg = progs.find((p) => p.helpChannel === config.slack.helpChannel);
    if (helpProg) return helpProg;
  }

  return shared();
}

function isHelpChannel(channelId) {
  if (!channelId) return false;
  const progs = all();
  if (progs.some((p) => p.helpChannel === channelId)) return true;
  if (config?.slack?.helpChannel && channelId === config.slack.helpChannel) return true;
  return false;
}

function helpChannelName(programId = null) {
  const p = programId ? get(programId) : (all()[0] || null);
  if (p && p.helpChannel) return p.helpChannel;
  if (config?.slack?.helpChannel) return config.slack.helpChannel;
  return null;
}

function posture(programId) {
  const p = get(programId);
  return p ? (p.posture || "active") : "active";
}

function scope(programId) {
  const p = get(programId);
  return p && p.scope === "program" ? "program" : "any";
}

function isProgramScoped(program) {
  if (!program) return false;
  if (typeof program === "string") return scope(program) === "program";
  return program.scope === "program";
}

function saveProgram(prog) {
  db.saveProgram(prog);
  invalidate();
}

function removeProgram(id) {
  db.deleteProgram(id);
  invalidate();
}

function getChannelsList() {
  const progs = all();
  const channelsMap = new Map();

  for (const p of progs) {
    if (p.helpChannel) {
      channelsMap.set(p.helpChannel, {
        channelId: p.helpChannel,
        programId: p.id,
        programName: p.name,
        isHelpChannel: true,
        isTicketDestination: true,
        posture: p.posture || "active",
        replyEnabled: p.posture !== "muted",
        type: "help",
      });
    }
    if (Array.isArray(p.channels)) {
      for (const ch of p.channels) {
        if (!channelsMap.has(ch)) {
          channelsMap.set(ch, {
            channelId: ch,
            programId: p.id,
            programName: p.name,
            isHelpChannel: ch === p.helpChannel,
            isTicketDestination: ch === p.helpChannel,
            posture: p.posture || "active",
            replyEnabled: p.posture !== "muted",
            type: ch === p.helpChannel ? "help" : "discussion",
          });
        }
      }
    }
  }

  if (config?.slack?.helpChannel && !channelsMap.has(config.slack.helpChannel)) {
    channelsMap.set(config.slack.helpChannel, {
      channelId: config.slack.helpChannel,
      programId: "pixl",
      programName: "Pixl",
      isHelpChannel: true,
      isTicketDestination: true,
      posture: "active",
      replyEnabled: true,
      type: "help",
    });
  }

  if (Array.isArray(config?.slack?.faqChannels)) {
    for (const ch of config.slack.faqChannels) {
      if (!channelsMap.has(ch)) {
        channelsMap.set(ch, {
          channelId: ch,
          programId: "pixl",
          programName: "Pixl",
          isHelpChannel: ch === config?.slack?.helpChannel,
          isTicketDestination: ch === config?.slack?.helpChannel,
          posture: "active",
          replyEnabled: true,
          type: ch === config?.slack?.helpChannel ? "help" : "discussion",
        });
      }
    }
  }

  return Array.from(channelsMap.values());
}

function addChannelToProgram(programId, channelId, isHelp = false) {
  const p = get(programId) || (all()[0] || null);
  if (!p) return false;

  const channels = new Set(Array.isArray(p.channels) ? p.channels : []);
  channels.add(channelId);

  const updated = {
    ...p,
    channels: Array.from(channels),
    helpChannel: isHelp ? channelId : p.helpChannel,
  };
  saveProgram(updated);
  return true;
}

function removeChannelFromProgram(programId, channelId) {
  const p = get(programId);
  if (!p) return false;

  const channels = (Array.isArray(p.channels) ? p.channels : []).filter((c) => c !== channelId);
  const helpChannel = p.helpChannel === channelId ? null : p.helpChannel;

  const updated = {
    ...p,
    channels,
    helpChannel,
  };
  saveProgram(updated);
  return true;
}

function setChannelTicketDestination(programId, channelId) {
  const p = get(programId);
  if (!p) return false;

  const channels = new Set(Array.isArray(p.channels) ? p.channels : []);
  channels.add(channelId);

  const updated = {
    ...p,
    channels: Array.from(channels),
    helpChannel: channelId,
  };
  saveProgram(updated);
  return true;
}

module.exports = {
  all,
  get,
  shared,
  forChannel,
  isHelpChannel,
  helpChannelName,
  posture,
  scope,
  isProgramScoped,
  saveProgram,
  removeProgram,
  getChannelsList,
  addChannelToProgram,
  removeChannelFromProgram,
  setChannelTicketDestination,
  invalidate,
};
