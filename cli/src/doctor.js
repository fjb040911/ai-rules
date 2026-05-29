const path = require("path");
const fs = require("fs/promises");
const { loadRuleContext } = require("./core/rules/load-rule-context");
const { validateConfig } = require("./core/config/validate-config");
const { validateRules } = require("./core/rules/validate-rules");
const { readSkillInstallManifest } = require("./core/skills/manifest");
const {
  AI_LAW_BASH_ALLOW,
  AI_LAW_BASH_ALLOW_ALT,
} = require("./setup");

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
  let rules;
  try {
    const ruleContext = await loadRuleContext({ cwd, configPath });
    config = ruleContext.config;
    rules = ruleContext.rules;
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

  findings.push(...(await validateConfig({ config, cwd, configDir: aiRulesDir })));

  const rulesFile = config.rulesFile || ".ai-rules.md";
  const rulesPath = path.resolve(path.dirname(configPath), rulesFile);
  const hasRules = await fileExists(rulesPath);
  if (!hasRules) {
    findings.push({ level: "error", message: `Rules file not found: ${path.relative(cwd, rulesPath)}` });
    return printDoctorResult(findings, strict);
  }

  findings.push(...validateRules({ rules, config }));
  findings.push(...(await validateSkills({ cwd, aiRulesDir })));

  return printDoctorResult(findings, strict);
}

async function validateSkills({ cwd, aiRulesDir }) {
  const findings = [];
  const { manifestPath, manifest } = await readSkillInstallManifest(cwd);
  const hasExistingSkillLayout = await detectAnySkillLayout(cwd);

  if (!manifest) {
    if (hasExistingSkillLayout) {
      findings.push({
        level: "warn",
        message:
          "Skill files exist but .ai-rules/cache/skill-manifest.json is missing. Re-run `ai-law setup --provider <name> --write` to regenerate the managed manifest.",
      });
    }
    return findings;
  }

  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    findings.push({
      level: "warn",
      message: `${path.relative(cwd, manifestPath)} does not declare any skills.`,
    });
    return findings;
  }

  for (const skill of manifest.skills) {
    const exists = await fileExists(skill.path);
    if (!exists) {
      findings.push({
        level: "warn",
        message: `Managed skill '${skill.name}' is missing at ${skill.path}. Re-run ai-law setup --provider ${manifest.provider} --write.`,
      });
    }
  }

  if (manifest.provider === "claude-code") {
    const settingsPath = path.join(cwd, ".claude", "settings.local.json");
    const data = await readJsonFile(settingsPath);
    const allow = data && data.permissions && data.permissions.allow;
    const hasAllow =
      Array.isArray(allow) &&
      allow.some((entry) => entry === AI_LAW_BASH_ALLOW || entry === AI_LAW_BASH_ALLOW_ALT);
    if (!hasAllow) {
      findings.push({
        level: "warn",
        message:
          ".claude/settings.local.json is missing Bash(ai-law:*) in permissions.allow, so Claude Code skills may not be able to execute ai-law commands.",
      });
    }
  }

  return findings;
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

async function detectAnySkillLayout(cwd) {
  const candidates = [
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".cursor", "skills"),
    path.join(cwd, ".ai-rules", "skills"),
    path.join(cwd, ".github", "prompts"),
  ];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return true;
    }
  }
  return false;
}

async function readJsonFile(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  runDoctor,
};
