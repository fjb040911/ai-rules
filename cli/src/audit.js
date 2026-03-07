const path = require("path");
const fs = require("fs/promises");
const clipboardy = require("clipboardy");
const writeClipboard =
  (clipboardy.write && clipboardy.write.bind(clipboardy)) ||
  (clipboardy.default && clipboardy.default.write
    ? clipboardy.default.write.bind(clipboardy.default)
    : null);
const { readJson } = require("./utils/fs");
const { getTemplatesRoot } = require("./utils/templates");

async function runAudit(argv) {
  const locale = parseLocaleArg(argv) || "en";
  const localeMap = await readLocaleMap(locale);
  const prompt = buildAuditPrompt(localeMap);

  process.stdout.write(prompt + "\n");

  try {
    if (!writeClipboard) {
      throw new Error("clipboardy.write is not available");
    }
    await writeClipboard(prompt);
    process.stdout.write("Prompt copied to clipboard.\n");
  } catch (err) {
    process.stderr.write(`Clipboard copy failed: ${String(err)}\n`);
  }
}

function parseLocaleArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--locale" || arg === "-l") {
      return argv[i + 1];
    }
  }
  return null;
}

async function readLocaleMap(locale) {
  const templatesRoot = getTemplatesRoot();
  const localePath = path.join(templatesRoot, "i18n", `${locale}.json`);

  try {
    await fs.access(localePath);
    return readJson(localePath);
  } catch {
    if (locale === "en") {
      throw new Error("Default locale 'en' not found in templates/i18n.");
    }
    const fallbackPath = path.join(templatesRoot, "i18n", "en.json");
    const exists = await fileExists(fallbackPath);
    if (!exists) {
      throw new Error("Fallback locale 'en' not found in templates/i18n.");
    }
    process.stderr.write(`Locale '${locale}' not found. Falling back to en.\n`);
    return readJson(fallbackPath);
  }
}

function buildAuditPrompt(localeMap) {
  const key = "prompt.audit.cli";
  return resolve(localeMap, key);
}

function resolve(localeMap, key) {
  return localeMap[key] || key;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { runAudit };
