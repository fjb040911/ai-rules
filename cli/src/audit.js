const path = require("path");
const fs = require("fs/promises");
const { writeOutput } = require("./utils/output");
const { readJson } = require("./utils/fs");
const { getTemplatesRoot } = require("./utils/templates");
const { loadConfig } = require("./core/config/load-config");
const { parseRules } = require("./core/rules/parse-rules");
const { validateRules } = require("./core/rules/validate-rules");
const { collectEvidence } = require("./core/evidence/collect");
const { buildAuditPrompt } = require("./core/prompt/build-audit-prompt");
const { getReportSchemaText } = require("./core/report/schema");

async function runAudit(argv) {
  const locale = parseLocaleArg(argv) || (await readDefaultLocale()) || "en";
  const localeMap = await readLocaleMap(locale);
  const outputJson = argv.includes("--json");
  const dumpContext = argv.includes("--dump-context");
  const context = await buildAuditContext({ cwd: process.cwd(), localeMap });

  if (context.findings.some((item) => item.level === "error")) {
    for (const finding of context.findings) {
      const prefix = finding.level === "error" ? "ERROR" : "WARN";
      process.stderr.write(`[${prefix}] ${finding.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (dumpContext) {
    await writeAuditContext(process.cwd(), context);
  }

  if (outputJson) {
    process.stdout.write(JSON.stringify(context, null, 2) + "\n");
    return;
  }

  const prompt = buildAuditPrompt({
    config: context.config,
    rules: context.rules,
    evidence: context.evidence,
    localeMap,
    reportSchemaText: getReportSchemaText(),
  });
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
    const config = await loadConfig(configPath);
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

async function buildAuditContext({ cwd, localeMap }) {
  const configPath = path.join(cwd, ".ai-rules", "rules-config.json");
  const config = await loadConfig(configPath);
  const rulesFile = config.rulesFile || ".ai-rules.md";
  const rulesPath = path.join(cwd, ".ai-rules", rulesFile);
  const rules = await parseRules(rulesPath);
  const findings = validateRules({ rules, config });
  const evidence = await collectEvidence({ cwd, config, rules });

  return {
    version: "0.3",
    generatedAt: new Date().toISOString(),
    locale: inferLocale(config, localeMap),
    config,
    rules,
    evidence,
    findings,
  };
}

async function writeAuditContext(cwd, context) {
  const cacheDir = path.join(cwd, ".ai-rules", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, "audit-context.json"),
    JSON.stringify(context, null, 2) + "\n",
    "utf8"
  );
}

function inferLocale(config) {
  return (config.i18n && config.i18n.defaultLocale) || "en";
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
