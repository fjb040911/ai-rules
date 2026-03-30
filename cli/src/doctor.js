const path = require("path");
const fs = require("fs/promises");
const { loadConfig } = require("./core/config/load-config");
const { parseRules } = require("./core/rules/parse-rules");
const { validateRules } = require("./core/rules/validate-rules");

async function runDoctor(argv) {
  const cwd = process.cwd();
  const strict = argv.includes("--strict");
  const aiRulesDir = path.join(cwd, ".ai-rules");
  const configPath = path.join(aiRulesDir, "rules-config.json");

  const findings = [];
  const hasDir = await isDirectory(aiRulesDir);
  if (!hasDir) {
    findings.push({ level: "error", message: ".ai-rules directory not found." });
    return printDoctorResult(findings, strict);
  }

  const hasConfig = await fileExists(configPath);
  if (!hasConfig) {
    findings.push({ level: "error", message: ".ai-rules/rules-config.json not found." });
    return printDoctorResult(findings, strict);
  }

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    findings.push({ level: "error", message: `Failed to load config: ${String(err.message || err)}` });
    return printDoctorResult(findings, strict);
  }

  if (!Array.isArray(config.enabledRuleIds) || config.enabledRuleIds.length === 0) {
    findings.push({ level: "error", message: "enabledRuleIds must be a non-empty array." });
  }

  if (!Array.isArray(config.scopes) || config.scopes.length === 0) {
    findings.push({ level: "warn", message: "scopes is empty; scope validation will be limited." });
  }

  const rulesFile = config.rulesFile || ".ai-rules.md";
  const rulesPath = path.resolve(path.dirname(configPath), rulesFile);
  const hasRules = await fileExists(rulesPath);
  if (!hasRules) {
    findings.push({ level: "error", message: `Rules file not found: ${path.relative(cwd, rulesPath)}` });
    return printDoctorResult(findings, strict);
  }

  try {
    const rules = await parseRules(rulesPath);
    findings.push(...validateRules({ rules, config }));
  } catch (err) {
    findings.push({ level: "error", message: `Failed to parse rules: ${String(err.message || err)}` });
  }

  return printDoctorResult(findings, strict);
}

function printDoctorResult(findings, strict) {
  const errorCount = findings.filter((item) => item.level === "error").length;
  const warnCount = findings.filter((item) => item.level === "warn").length;

  process.stdout.write("AI-LAW doctor\n\n");

  if (findings.length === 0) {
    process.stdout.write("No issues found.\n");
    return;
  }

  for (const finding of findings) {
    const prefix = finding.level === "error" ? "ERROR" : "WARN";
    process.stdout.write(`[${prefix}] ${finding.message}\n`);
  }

  process.stdout.write(`\nSummary: ${errorCount} error(s), ${warnCount} warning(s)\n`);
  if (errorCount > 0 || (strict && warnCount > 0)) {
    process.exitCode = 1;
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

async function isDirectory(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

module.exports = {
  runDoctor,
};
