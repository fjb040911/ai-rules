const path = require("path");
const fs = require("fs/promises");
const { writeOutput } = require("./utils/output");
const { readLocaleMap } = require("./utils/templates");
const { loadConfig } = require("./core/config/load-config");
const { validateConfig } = require("./core/config/validate-config");
const { resolveAstConfig } = require("./core/config/resolve-ast-config");
const { parseRules } = require("./core/rules/parse-rules");
const { resolveRulePaths } = require("./core/rules/resolve-rules");
const { compileRulesToIR } = require("./core/rules/compile-rule-ir");
const { validateRules } = require("./core/rules/validate-rules");
const { collectEvidence } = require("./core/evidence/collect");
const { buildAuditPrompt } = require("./core/prompt/build-audit-prompt");
const { getReportSchemaText, buildReportTemplate } = require("./core/report/schema");

async function runAudit(argv) {
  const locale = parseLocaleArg(argv) || (await readDefaultLocale()) || "en";
  const localeMap = await readLocaleMap(locale);
  const outputJson = argv.includes("--json");
  const dumpContext = argv.includes("--dump-context");
  const outputSummary = argv.includes("--summary");
  const outputDryRun = argv.includes("--dry-run");
  const context = await buildAuditContext({ cwd: process.cwd(), localeMap });

  if (context.findings.some((item) => item.level === "error")) {
    printFindings(context.findings);
    process.exitCode = 1;
    return;
  }

  printFindings(context.findings.filter((item) => item.level === "warn"));

  await writeAuditArtifacts(process.cwd(), context, { forceContextWrite: dumpContext });

  if (outputJson) {
    process.stdout.write(JSON.stringify(context, null, 2) + "\n");
    return;
  }

  if (outputSummary) {
    process.stdout.write(formatSummary(context.summary) + "\n");
    return;
  }

  if (outputDryRun) {
    process.stdout.write(formatDryRun(context.dryRun) + "\n");
    return;
  }

  const prompt = buildAuditPrompt({
    config: context.config,
    rules: context.ruleIR,
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
  config.resolvedAstConfig = await resolveAstConfig({ cwd, config });
  const rulesFile = config.rulesFile || ".ai-rules.md";
  const rulesPath = path.join(cwd, ".ai-rules", rulesFile);
  const rules = resolveRulePaths(await parseRules(rulesPath), config);
  const ruleIR = compileRulesToIR({ config, rules });
  const findings = [
    ...(await validateConfig({ config, cwd, configDir: path.join(cwd, ".ai-rules") })),
    ...validateRules({ rules, config }),
  ];
  const evidence = await collectEvidence({ cwd, config, rules });
  const summary = buildAuditSummary({ config, ruleIR, evidence });
  const dryRun = buildDryRun({ config, ruleIR, evidence });

  return {
    version: readCliVersion(),
    generatedAt: new Date().toISOString(),
    locale: inferLocale(config, localeMap),
    config,
    rules,
    ruleIR,
    evidence,
    findings,
    summary,
    dryRun,
  };
}

function printFindings(findings) {
  for (const finding of findings) {
    const prefix = finding.level === "error" ? "ERROR" : "WARNING";
    process.stderr.write(`\n========== AI-RULES ${prefix} ==========\n`);
    process.stderr.write(`${finding.message}\n`);
    process.stderr.write("========================================\n");
  }
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

async function writeAuditArtifacts(cwd, context, { forceContextWrite }) {
  await writeAuditContext(cwd, context);
  await writeReportTemplate(cwd, context);
  await writeRuleIR(cwd, context);

  if (!forceContextWrite) {
    process.stderr.write(
      "Wrote .ai-rules/cache/audit-context.json, .ai-rules/cache/rule-ir.json and .ai-rules/cache/ai-rule-report.template.json\n"
    );
    process.stderr.write(
      "After your AI returns the audit result, save it as ai-rule-report.json and run: ai-law validate-report\n"
    );
  }
}

async function writeRuleIR(cwd, context) {
  const cacheDir = path.join(cwd, ".ai-rules", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, "rule-ir.json"),
    JSON.stringify(
      {
        version: context.version,
        generatedAt: context.generatedAt,
        stack: context.config && context.config.stack,
        rules: context.ruleIR || [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function writeReportTemplate(cwd, context) {
  const cacheDir = path.join(cwd, ".ai-rules", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  const template = buildReportTemplate({ stack: context.config && context.config.stack });
  await fs.writeFile(
    path.join(cacheDir, "ai-rule-report.template.json"),
    JSON.stringify(template, null, 2) + "\n",
    "utf8"
  );
}

function inferLocale(config) {
  return (config.i18n && config.i18n.defaultLocale) || "en";
}

function buildAuditSummary({ config, ruleIR, evidence }) {
  const enabledRules = new Set(config.enabledRuleIds || []);
  const activeRules = ruleIR.filter((rule) => enabledRules.has(rule.id));
  const relevantEvidence = evidence.filter((item) => enabledRules.has(item.ruleId));
  const localEvidenceItems = relevantEvidence.filter((item) => item.mode !== "ai-only");

  return {
    stack: config.stack || "unknown",
    enabledRuleCount: activeRules.length,
    localEvidenceRuleCount: localEvidenceItems.length,
    aiOnlyRuleCount: relevantEvidence.filter((item) => item.mode === "ai-only").length,
    totalLocalEvidenceMatches: localEvidenceItems.reduce((sum, item) => sum + (item.totalMatches || 0), 0),
    suppressedFileCount: relevantEvidence.reduce((sum, item) => sum + (item.suppressedFileCount || 0), 0),
    thresholds: config.thresholds || {},
  };
}

function buildDryRun({ config, ruleIR, evidence }) {
  const enabledRules = new Set(config.enabledRuleIds || []);
  const activeRules = ruleIR.filter((rule) => enabledRules.has(rule.id));
  const evidenceByRule = new Map(evidence.map((item) => [item.ruleId, item]));

  return {
    stack: config.stack || "unknown",
    includePatterns: (config.detectOptions && config.detectOptions.include) || [],
    excludePatterns: (config.detectOptions && config.detectOptions.exclude) || [],
    localRuleIds: activeRules
      .filter((rule) => {
        const item = evidenceByRule.get(rule.id);
        return item && item.mode !== "ai-only";
      })
      .map((rule) => rule.id),
    aiOnlyRuleIds: activeRules
      .filter((rule) => {
        const item = evidenceByRule.get(rule.id);
        return !item || item.mode === "ai-only";
      })
      .map((rule) => rule.id),
    exceptionPatterns: Object.entries(config.exceptions || {}).map(
      ([rulePattern, patterns]) => `${rulePattern}: ${patterns.join(", ")}`
    ),
  };
}

function formatSummary(summary) {
  return [
    "AI-RULES AUDIT SUMMARY",
    `- stack: ${summary.stack}`,
    `- enabled rule count: ${summary.enabledRuleCount}`,
    `- local-evidence rule count: ${summary.localEvidenceRuleCount}`,
    `- ai-only rule count: ${summary.aiOnlyRuleCount}`,
    `- total local evidence matches: ${summary.totalLocalEvidenceMatches}`,
    `- suppressed file count: ${summary.suppressedFileCount}`,
    `- configured thresholds: ${formatKeyValueMap(summary.thresholds)}`,
  ].join("\n");
}

function formatDryRun(dryRun) {
  return [
    "AI-RULES AUDIT DRY RUN",
    `- stack: ${dryRun.stack}`,
    `- include patterns: ${formatList(dryRun.includePatterns)}`,
    `- exclude patterns: ${formatList(dryRun.excludePatterns)}`,
    `- local rules: ${formatList(dryRun.localRuleIds)}`,
    `- ai-only rules: ${formatList(dryRun.aiOnlyRuleIds)}`,
    `- exception patterns: ${formatList(dryRun.exceptionPatterns)}`,
  ].join("\n");
}

function formatList(items) {
  if (!items || items.length === 0) {
    return "(none)";
  }
  return items.join(", ");
}

function formatKeyValueMap(value) {
  if (!value || Object.keys(value).length === 0) {
    return "(none)";
  }
  return Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join(", ");
}

function readCliVersion() {
  try {
    const packagePath = path.join(__dirname, "..", "..", "package.json");
    const pkg = require(packagePath);
    return pkg && pkg.version ? String(pkg.version) : "unknown";
  } catch {
    return "unknown";
  }
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { runAudit, buildAuditContext };
