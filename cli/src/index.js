#!/usr/bin/env node

const path = require("path");
const fs = require("fs/promises");

async function main() {
  const cmd = process.argv[2];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(getHelpText());
    return;
  }

  if (cmd === "-v" || cmd === "--version" || cmd === "version") {
    process.stdout.write(getVersionText() + "\n");
    return;
  }

  if (cmd === "init") {
    const { runInit } = require("./init");
    await runInit();
    return;
  }

  if (cmd === "setup") {
    const { runSetup } = require("./setup");
    await runSetup(process.argv.slice(3));
    return;
  }

  if (cmd === "doctor") {
    const { runDoctor } = require("./doctor");
    await runDoctor(process.argv.slice(3));
    return;
  }

  if (cmd === "validate-report") {
    const { runValidateReport } = require("./validate");
    await runValidateReport(process.argv.slice(3));
    return;
  }

  const hasRules = await hasAiRulesDir(process.cwd());
  if (!hasRules) {
    process.stderr.write(".ai-rules not found. Run: ai-law init\n");
    process.exitCode = 1;
    return;
  }

  if (cmd === "audit") {
    const { runAudit } = require("./audit");
    await runAudit(process.argv.slice(3));
    return;
  }

  if (cmd === "fix") {
    const { runFix } = require("./fix");
    await runFix(process.argv.slice(3));
    return;
  }

  process.stderr.write(
    "Unknown command. Use: ai-law init | ai-law audit | ai-law fix | ai-law setup | ai-law doctor\n"
  );
  process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exitCode = 1;
});

function getHelpText() {
  return [
    "AI-LAW CLI",
    "",
    "Usage:",
    "  ai-law <command> [options]",
    "",
    "Commands:",
    "  init                      Initialize .ai-rules in current directory",
    "  version                   Show CLI version",
    "  audit [--locale <code>]   Generate a rule-aware audit prompt and copy it to clipboard",
    "  fix --id <rule_id>        Copy the fix prompt for a rule from ai-rule-report.json",
    "  fix --issueId <issue_id>  Copy the fix prompt for a specific issue instance",
    "  fix --all                 Copy the fix prompt for all issues in the report",
    "  setup [--locale <code>]   Generate AI-tool setup prompt and copy it to clipboard",
    "  setup --write             Write/update slash command files for a selected provider",
    "  doctor [--strict]         Validate .ai-rules config and parsed rules",
    "  validate-report [--json]  Normalize and validate ai-rule-report.json",
    "",
    "Options:",
    "  -h, --help                Show this help message",
    "  -v, --version             Show CLI version",
    "  -l, --locale <code>       Locale for audit prompt (default: en)",
    "      --json                Print audit context JSON instead of prompt",
    "      --dump-context        Write .ai-rules/cache/audit-context.json",
    "  -p, --provider <name>     Setup provider: copilot|codex|cursor|claude-code|custom",
    "      --write               Write slash command files (OpenSpec-style managed update)",
    "      --strict              Treat warnings as failures in doctor",
    "      --path <file>         Custom path for validate-report",
    "      --group-by-rule       Group fix --all output by rule",
    "  -i, --id <rule_id>        Rule ID for fix command (required)",
    "      --issueId <issue_id>  Issue ID for fix command (preferred when available)",
    "",
    "Examples:",
    "  ai-law init",
    "  ai-law -v",
    "  ai-law audit",
    "  ai-law audit --locale zh-CN",
    "  ai-law audit --dump-context",
    "  ai-law audit --json",
    "  ai-law fix --id ARCH-101",
    "  ai-law fix --issueId ISSUE-001",
    "  ai-law fix --all --group-by-rule",
    "  ai-law setup",
    "  ai-law setup --provider cursor --locale en",
    "  ai-law setup --provider copilot --write",
    "  ai-law doctor",
    "  ai-law validate-report --json",
    "",
  ].join("\n");
}

function getVersionText() {
  try {
    const packagePath = path.join(__dirname, "..", "..", "package.json");
    const content = require(packagePath);
    if (content && content.version) {
      return String(content.version);
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function hasAiRulesDir(cwd) {
  const target = path.join(cwd, ".ai-rules");
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
