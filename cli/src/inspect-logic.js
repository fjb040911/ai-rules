const path = require("path");
const fs = require("fs/promises");
const { readLocaleMap } = require("./utils/templates");
const { writeOutput } = require("./utils/output");
const { loadRuleContext } = require("./core/rules/load-rule-context");
const { validateConfig } = require("./core/config/validate-config");
const { validateRules } = require("./core/rules/validate-rules");
const { runRuleValidator } = require("./core/validator/run-rule-validator");
const { getLogicReportSchemaText, buildLogicReportTemplate } = require("./core/logic/schema");
const { buildLogicPrompt } = require("./core/logic/build-logic-prompt");

async function runInspectLogic(argv) {
  const locale = parseLocaleArg(argv) || (await readDefaultLocale()) || "en";
  const localeMap = await readLocaleMap(locale);
  const outputJson = argv.includes("--json");
  const dumpContext = argv.includes("--dump-context");
  const context = await buildLogicContext({ cwd: process.cwd(), localeMap });

  if (context.findings.some((item) => item.level === "error")) {
    printFindings(context.findings);
    process.exitCode = 1;
    return;
  }

  printFindings(context.findings.filter((item) => item.level === "warn"));
  await writeLogicArtifacts(process.cwd(), context, { forceContextWrite: dumpContext });

  if (outputJson) {
    process.stdout.write(JSON.stringify(context, null, 2) + "\n");
    return;
  }

  const prompt = buildLogicPrompt({
    config: context.config,
    ruleIR: context.ruleIR,
    validator: context.validator,
    logicContext: context.logicContext,
    localeMap,
    reportSchemaText: getLogicReportSchemaText(),
  });
  writeOutput(prompt);
}

async function buildLogicContext({ cwd, localeMap }) {
  const { config, rules, ruleIR } = await loadRuleContext({ cwd });
  const findings = [
    ...(await validateConfig({ config, cwd, configDir: path.join(cwd, ".ai-rules") })),
    ...validateRules({ rules, config }),
  ];
  const validator = await runRuleValidator({ cwd, config, rules, ruleIR });

  return {
    version: readCliVersion(),
    generatedAt: new Date().toISOString(),
    locale: inferLocale(config, localeMap),
    config,
    rules,
    ruleIR,
    validator,
    logicContext: buildLogicHeuristics({ config, ruleIR, validator }),
    findings,
  };
}

function buildLogicHeuristics({ config, ruleIR, validator }) {
  const riskKeywords = [
    "approve",
    "cancel",
    "refund",
    "transfer",
    "publish",
    "ownerId",
    "tenantId",
    "role",
    "permission",
    "status",
  ];
  const highRiskFiles = new Set();

  for (const rule of (ruleIR || []).filter((item) => item.enabled)) {
    for (const entry of rule.context || []) {
      highRiskFiles.add(entry);
    }
  }

  for (const violation of (validator && validator.violations) || []) {
    for (const file of violation.files || []) {
      highRiskFiles.add(file);
    }
  }

  return {
    riskKeywords,
    highRiskFiles: [...highRiskFiles].slice(0, 40),
    includePatterns: (config.detectOptions && config.detectOptions.include) || [],
    validatorViolationCount: (validator.summary && validator.summary.validatorViolationCount) || 0,
  };
}

async function writeLogicArtifacts(cwd, context, { forceContextWrite }) {
  const cacheDir = path.join(cwd, ".ai-rules", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, "logic-audit-context.json"),
    JSON.stringify(context, null, 2) + "\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(cacheDir, "ai-logic-report.template.json"),
    JSON.stringify(buildLogicReportTemplate({ stack: context.config && context.config.stack }), null, 2) + "\n",
    "utf8"
  );

  if (!forceContextWrite) {
    process.stderr.write(
      "Wrote .ai-rules/cache/logic-audit-context.json and .ai-rules/cache/ai-logic-report.template.json\n"
    );
    process.stderr.write(
      "After your AI returns the logic inspection result, save it as ai-logic-report.json in the project root.\n"
    );
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

async function readDefaultLocale() {
  const configPath = path.join(process.cwd(), ".ai-rules", "rules-config.json");
  try {
    const { config } = await loadRuleContext({ cwd: process.cwd(), configPath });
    return (config && config.i18n && config.i18n.defaultLocale) || null;
  } catch {
    return null;
  }
}

function printFindings(findings) {
  for (const finding of findings) {
    const prefix = finding.level === "error" ? "ERROR" : "WARNING";
    process.stderr.write(`\n========== AI-RULES ${prefix} ==========\n`);
    process.stderr.write(`${finding.message}\n`);
    process.stderr.write("========================================\n");
  }
}

function inferLocale(config) {
  return (config.i18n && config.i18n.defaultLocale) || "en";
}

function readCliVersion() {
  try {
    return require(path.join(__dirname, "..", "..", "package.json")).version || "unknown";
  } catch {
    return "unknown";
  }
}

module.exports = {
  runInspectLogic,
};
