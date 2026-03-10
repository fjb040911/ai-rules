const path = require("path");
const fs = require("fs/promises");
const { writeOutput } = require("./utils/output");
const { readJson } = require("./utils/fs");
const { getTemplatesRoot } = require("./utils/templates");

async function runAudit(argv) {
  const locale = parseLocaleArg(argv) || (await readDefaultLocale()) || "en";
  const localeMap = await readLocaleMap(locale);
  const prompt = buildAuditPrompt(localeMap);
  writeOutput(prompt);
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

async function readDefaultLocale() {
  const configPath = path.join(process.cwd(), ".ai-rules", "rules-config.json");
  const exists = await fileExists(configPath);
  if (!exists) {
    return null;
  }

  try {
    const config = await readJson(configPath);
    const locale =
      config &&
      config.i18n &&
      typeof config.i18n.defaultLocale === "string"
        ? config.i18n.defaultLocale
        : null;
    return locale;
  } catch {
    return null;
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
