// Public GitHub repository validator for Hack Club YSWS submissions.
// Checks LICENSE presence, README completeness (build instructions, demo/screenshots),
// and project readiness.

const axios = require("axios");
const log = require("./log");

const GITHUB_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/|\.git|\/tree\/[a-zA-Z0-9_.-]+)?/i;

const OPEN_SOURCE_LICENSES = [
  { id: "mit", name: "MIT License", regex: /\bMIT License|\bPermission is hereby granted, free of charge/i },
  { id: "apache-2.0", name: "Apache 2.0", regex: /\bApache License,?\s+Version 2\.0/i },
  { id: "gpl-3.0", name: "GPL v3", regex: /\bGNU GENERAL PUBLIC LICENSE\s+Version 3/i },
  { id: "gpl-2.0", name: "GPL v2", regex: /\bGNU GENERAL PUBLIC LICENSE\s+Version 2/i },
  { id: "bsd-3-clause", name: "BSD 3-Clause", regex: /\bRedistribution and use in source and binary forms|\bBSD 3-Clause/i },
  { id: "bsd-2-clause", name: "BSD 2-Clause", regex: /\bBSD 2-Clause/i },
  { id: "isc", name: "ISC License", regex: /\bPermission to use, copy, modify, and\/or distribute this software for any purpose/i },
  { id: "mpl-2.0", name: "Mozilla Public License 2.0", regex: /\bMozilla Public License\s+v\.\s*2\.0/i },
  { id: "unlicense", name: "The Unlicense", regex: /\bThis is free and unencumbered software released into the public domain/i },
];

function parseGithubUrl(text) {
  if (!text) return null;
  const match = String(text).match(GITHUB_URL_REGEX);
  if (!match) return null;
  let owner = match[1];
  let repo = match[2];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  return { owner, repo, fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

async function fetchRawFile(owner, repo, filename) {
  const branches = ["main", "master"];
  for (const branch of branches) {
    try {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.status === 200 && typeof res.data === "string") {
        return res.data;
      }
    } catch (e) {
      // Try next branch or filename
    }
  }
  return null;
}

function detectLicense(content) {
  if (!content || !content.trim()) return null;
  for (const lic of OPEN_SOURCE_LICENSES) {
    if (lic.regex.test(content)) return lic.name;
  }
  return "Custom / Unknown Open Source License";
}

function analyzeReadme(readmeText) {
  if (!readmeText || !readmeText.trim()) {
    return {
      hasReadme: false,
      wordCount: 0,
      hasInstructions: false,
      hasDemo: false,
      hasScreenshots: false,
    };
  }

  const words = readmeText.trim().split(/\s+/).length;
  const hasInstructions = /\b(?:run|build|install|setup|start|usage|getting started|how to|npm (?:run|install|start)|cargo build|python|pip install|yarn|pnpm|make)\b/i.test(readmeText);
  const hasDemo = /\b(?:demo|live|video|youtube\.com|youtu\.be|loom\.com|playable|deployed|website|play\.pixl|vercel\.app|netlify\.app|github\.io)\b/i.test(readmeText);
  const hasScreenshots = /\.(?:png|jpe?g|gif|webp|svg)\b|!\[.*?\]\(.*?\)|<img\s+[^>]*src=/i.test(readmeText);

  return {
    hasReadme: true,
    wordCount: words,
    hasInstructions,
    hasDemo,
    hasScreenshots,
  };
}

async function validateRepository(ownerOrUrl, repoName = null) {
  let owner = ownerOrUrl;
  let repo = repoName;

  if (!repoName) {
    const parsed = parseGithubUrl(ownerOrUrl);
    if (!parsed) return { ok: false, error: "Could not parse a valid GitHub repository URL." };
    owner = parsed.owner;
    repo = parsed.repo;
  }

  // Check License
  const licenseFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENSE-MIT", "LICENSE-APACHE"];
  let licenseText = null;
  let matchedLicenseFile = null;

  for (const fn of licenseFiles) {
    licenseText = await fetchRawFile(owner, repo, fn);
    if (licenseText) {
      matchedLicenseFile = fn;
      break;
    }
  }

  const licenseName = licenseText ? detectLicense(licenseText) : null;

  // Check README
  const readmeFiles = ["README.md", "README", "readme.md", "Readme.md"];
  let readmeText = null;
  let matchedReadmeFile = null;

  for (const fn of readmeFiles) {
    readmeText = await fetchRawFile(owner, repo, fn);
    if (readmeText) {
      matchedReadmeFile = fn;
      break;
    }
  }

  const readmeAnalysis = analyzeReadme(readmeText);

  // Determine readiness score
  const issues = [];
  const passes = [];
  const tips = [];

  if (licenseName) {
    passes.push(`License found: *${licenseName}* (${matchedLicenseFile})`);
  } else {
    issues.push(`*Missing open-source LICENSE!* YSWS requires an open-source license (like MIT or Apache 2.0).`);
  }

  if (readmeAnalysis.hasReadme) {
    if (readmeAnalysis.wordCount >= 30) {
      passes.push(`README.md is well-documented (${readmeAnalysis.wordCount} words)`);
    } else {
      tips.push(`README.md is very brief (${readmeAnalysis.wordCount} words). Add a couple sentences describing what your project does.`);
    }

    if (readmeAnalysis.hasInstructions) {
      passes.push(`Build and setup instructions detected in README`);
    } else {
      tips.push(`Add step-by-step build or run instructions (e.g. how reviewers can test your code).`);
    }

    if (readmeAnalysis.hasDemo || readmeAnalysis.hasScreenshots) {
      passes.push(`Demo link / screenshots detected in README`);
    } else {
      tips.push(`Add a screenshot, GIF, or demo link in your README to speed up reviewer approval.`);
    }
  } else {
    issues.push(`*Missing README.md file!* Add a README explaining what your project is and how to run it.`);
  }

  const isReady = issues.length === 0;

  return {
    ok: true,
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`,
    license: {
      found: Boolean(licenseText),
      name: licenseName,
      file: matchedLicenseFile,
    },
    readme: {
      found: readmeAnalysis.hasReadme,
      file: matchedReadmeFile,
      ...readmeAnalysis,
    },
    isReady,
    passes,
    issues,
    tips,
  };
}

function formatValidationReport(result) {
  if (!result || !result.ok) {
    return result?.error || "Could not inspect GitHub repository.";
  }

  const lines = [
    `*YSWS Submission Check for <${result.url}|${result.fullName}>:*`,
    "",
    result.isReady
      ? `🎉 *Ready for submission!* Everything looks solid for reviewer review.`
      : `⚠️ *Almost there!* A few items need attention before submitting:`,
    "",
  ];

  if (result.passes.length > 0) {
    lines.push("*What looks good:*");
    for (const p of result.passes) lines.push(`• ✅ ${p}`);
    lines.push("");
  }

  if (result.issues.length > 0) {
    lines.push("*Action items to fix:*");
    for (const item of result.issues) lines.push(`• 🔴 ${item}`);
    lines.push("");
  }

  if (result.tips.length > 0) {
    lines.push("*Reviewer approval tips:*");
    for (const tip of result.tips) lines.push(`• 💡 ${tip}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

module.exports = {
  parseGithubUrl,
  validateRepository,
  formatValidationReport,
  detectLicense,
  analyzeReadme,
};
