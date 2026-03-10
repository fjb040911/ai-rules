#!/usr/bin/env node

const { runInit } = require("./init");
const { runAudit } = require("./audit");
const { runFix } = require("./fix");
const { runSetup } = require("./setup");
const path = require("path");
const fs = require("fs/promises");

async function main() {
  const cmd = process.argv[2];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(getHelpText());
    return;
  }

  if (cmd === "init") {
    await runInit();
    return;
  }

  if (cmd === "setup") {
    await runSetup(process.argv.slice(3));
    return;
  }

  const hasRules = await hasAiRulesDir(process.cwd());
  if (!hasRules) {
    process.stderr.write(".ai-rules not found. Run: ai-law init\n");
    process.exitCode = 1;
    return;
  }

  if (cmd === "audit") {
    await runAudit(process.argv.slice(3));
    return;
  }

  if (cmd === "fix") {
    await runFix(process.argv.slice(3));
    return;
  }

  process.stderr.write(
    "Unknown command. Use: ai-law init | ai-law audit | ai-law fix | ai-law setup\n"
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
    "  audit [--locale <code>]   Generate an audit prompt and copy it to clipboard",
    "  fix --id <rule_id>        Copy the fix prompt for a rule from ai-rule-report.json",
    "  fix --issueId <issue_id>  Copy the fix prompt for a specific issue instance",
    "  setup [--locale <code>]   Generate AI-tool setup prompt and copy it to clipboard",
    "  setup --write             Write/update slash command files for a selected provider",
    "",
    "Options:",
    "  -h, --help                Show this help message",
    "  -l, --locale <code>       Locale for audit prompt (default: en)",
    "  -p, --provider <name>     Setup provider: copilot|codex|cursor|claude-code|custom",
    "      --write               Write slash command files (OpenSpec-style managed update)",
    "  -i, --id <rule_id>        Rule ID for fix command (required)",
    "      --issueId <issue_id>  Issue ID for fix command (preferred when available)",
    "",
    "Examples:",
    "  ai-law init",
    "  ai-law audit",
    "  ai-law audit --locale zh-CN",
    "  ai-law fix --id ARCH-101",
    "  ai-law fix --issueId ISSUE-001",
    "  ai-law setup",
    "  ai-law setup --provider cursor --locale en",
    "  ai-law setup --provider copilot --write",
    "",
  ].join("\n");
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
