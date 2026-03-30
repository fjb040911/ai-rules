const path = require("path");
const fs = require("fs/promises");
const { readJson } = require("./utils/fs");
const { writeOutput } = require("./utils/output");
const { loadConfig } = require("./core/config/load-config");
const { parseRules } = require("./core/rules/parse-rules");
const { normalizeReport } = require("./core/report/normalize");

async function runFix(argv) {
  const issueId = parseIssueIdArg(argv);
  const ruleId = parseIdArg(argv);
  const all = parseAllArg(argv);
  const groupByRule = argv.includes("--group-by-rule");

  if (!issueId && !ruleId && !all) {
    process.stderr.write("Missing required identifier. Use --issueId <issue_id> or --id <rule_id>.\n");
    process.stderr.write("Usage: ai-law fix --issueId <issue_id> | --id <rule_id> | --all\n");
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const reportPath = path.join(cwd, "ai-rule-report.json");
  const exists = await fileExists(reportPath);
  if (!exists) {
    process.stderr.write("ai-rule-report.json not found. Run: ai-law audit\n");
    process.exitCode = 1;
    return;
  }

  let rawReport;
  try {
    rawReport = await readJson(reportPath);
  } catch (err) {
    process.stderr.write(`Failed to read report: ${String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const normalized = normalizeReport(rawReport);
  if (normalized.findings.some((item) => item.level === "error")) {
    for (const finding of normalized.findings) {
      const prefix = finding.level === "error" ? "ERROR" : "WARN";
      process.stderr.write(`[${prefix}] ${finding.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const report = normalized.report;
  const projectRules = await maybeLoadProjectRules(cwd);

  let prompt = "";
  if (issueId) {
    const issue = findIssueByIssueId(report, issueId);
    if (!issue) {
      process.stderr.write(`No issue found for issueId: ${issueId}\n`);
      process.exitCode = 1;
      return;
    }

    const issueRuleId = ruleId || issue.ruleId || "UNKNOWN-RULE";
    prompt = buildAggregateRulePrompt([issue], issueRuleId, projectRules);
  } else if (all) {
    const issues = findAllIssues(report);
    if (!issues.length) {
      process.stderr.write("No issues found in report.\n");
      process.exitCode = 1;
      return;
    }

    prompt = buildAggregateAllPrompt(issues, projectRules, groupByRule);
  } else {
    const issues = findIssuesByRuleId(report, ruleId);
    if (!issues.length) {
      process.stderr.write(`No fix prompt found for rule id: ${ruleId}\n`);
      process.exitCode = 1;
      return;
    }

    prompt = buildAggregateRulePrompt(issues, ruleId, projectRules);
  }

  writeOutput(prompt);
}

function parseIdArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--id" || argv[i] === "-i") {
      return argv[i + 1];
    }
  }
  return null;
}

function parseIssueIdArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--issueId") {
      return argv[i + 1];
    }
  }
  return null;
}

function parseAllArg(argv) {
  return argv.includes("--all") || argv.includes("-all");
}

function findIssueByIssueId(report, issueId) {
  return findAllIssues(report).find((item) => item.issueId === issueId);
}

function findIssuesByRuleId(report, ruleId) {
  return findAllIssues(report).filter((item) => item.ruleId === ruleId);
}

function findAllIssues(report) {
  if (Array.isArray(report)) {
    return report;
  }
  if (Array.isArray(report.violations)) {
    return report.violations;
  }
  if (Array.isArray(report.issues)) {
    return report.issues;
  }
  if (Array.isArray(report.results)) {
    return report.results;
  }
  return [];
}

function buildAggregateRulePrompt(issues, ruleId, projectRules) {
  const rule = getRule(projectRules, ruleId);
  const lines = [
    `You need to fix violations of rule ${ruleId}.`,
    `Task: Fix all reported instances of ${ruleId} while preserving architecture boundaries and existing behavior.`,
    "Expected output: short fix plan + minimal patch-ready code edits + tests when behavior changes.",
    "",
    "Rule context:",
  ];

  appendRuleContext(lines, rule, ruleId);
  lines.push("", "Violations:");

  for (const issue of issues) {
    const location = formatLocation(issue);
    const prompt = issue.repairPrompt || buildFallbackPrompt(issue, ruleId, rule);

    lines.push(`- IssueId: ${issue.issueId}`);
    if (location) {
      lines.push(`  Location: ${location}`);
    }
    if (issue.confidence != null) {
      lines.push(`  Confidence: ${issue.confidence}`);
    }
    lines.push(`  Issue: ${issue.description}`);
    lines.push(`  Suggested direction: ${issue.fixSuggestion || fallbackSuggestion(rule)}`);
    if (issue.snippet) {
      lines.push(`  Snippet: ${issue.snippet}`);
    }
    if (issue.evidence && (issue.evidence.source || issue.evidence.matchedBy)) {
      lines.push(`  Evidence: source=${issue.evidence.source || "unknown"}, matchedBy=${issue.evidence.matchedBy || "unknown"}`);
    }
    lines.push("  Repair prompt:");
    lines.push(indentBlock(prompt, 4));
  }

  return lines.join("\n");
}

function buildAggregateAllPrompt(issues, projectRules, groupByRule) {
  if (groupByRule) {
    return Object.entries(groupIssuesByRule(issues))
      .map(([ruleId, group]) => buildAggregateRulePrompt(group, ruleId, projectRules))
      .join("\n\n");
  }

  const lines = [
    "You have multiple rule violations in this report.",
    "Task: Fix all violations across all rules with minimal, safe edits.",
    "Expected output: short fix plan + grouped patch-ready code edits + tests when needed.",
    "",
    "Violations:",
  ];

  for (const issue of issues) {
    const rule = getRule(projectRules, issue.ruleId);
    const prompt = issue.repairPrompt || buildFallbackPrompt(issue, issue.ruleId, rule);
    const location = formatLocation(issue);

    lines.push(`- Rule: ${issue.ruleId} | IssueId: ${issue.issueId}`);
    if (location) {
      lines.push(`  Location: ${location}`);
    }
    lines.push(`  Issue: ${issue.description}`);
    lines.push(`  Suggested direction: ${issue.fixSuggestion || fallbackSuggestion(rule)}`);
    if (issue.snippet) {
      lines.push(`  Snippet: ${issue.snippet}`);
    }
    lines.push("  Repair prompt:");
    lines.push(indentBlock(prompt, 4));
  }

  return lines.join("\n");
}

function appendRuleContext(lines, rule, ruleId) {
  if (!rule) {
    lines.push(`- Rule metadata for ${ruleId} was not found locally.`);
    return;
  }

  lines.push(`- severity: ${rule.severity || "unknown"}`);
  lines.push(`- scope: ${rule.scope || "unknown"}`);
  lines.push(`- intent: ${rule.intent || "unknown"}`);
  lines.push(`- requirement: ${(rule.prompt && rule.prompt.requirement) || "unknown"}`);
  lines.push(`- fix guidance: ${rule.fix || "unknown"}`);
  if (rule.context && rule.context.length > 0) {
    lines.push(`- context assets: ${rule.context.join(", ")}`);
  }
}

function buildFallbackPrompt(issue, ruleId, rule) {
  const location = formatLocation(issue);
  const context = mergeContexts(issue, rule);

  return [
    `You violated rule ${ruleId}.`,
    rule && rule.intent ? `Rule intent: ${rule.intent}` : null,
    rule && rule.prompt && rule.prompt.requirement ? `Requirement: ${rule.prompt.requirement}` : null,
    location ? `Location: ${location}.` : null,
    issue.snippet ? `Snippet: ${issue.snippet}` : null,
    `Issue: ${issue.description}`,
    "Task: Provide a minimal patch that fixes this violation and keeps existing architecture boundaries intact.",
    "Expected output: short step-by-step fix plan + patch-ready code edits.",
    `Suggested direction: ${issue.fixSuggestion || fallbackSuggestion(rule)}`,
    rule && rule.fix ? `Rule fix guidance: ${rule.fix}` : null,
    context ? `Available context: ${context}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeContexts(issue, rule) {
  const values = [];
  for (const entry of issue.context || []) {
    if (!values.includes(entry)) {
      values.push(entry);
    }
  }
  for (const entry of (rule && rule.context) || []) {
    if (!values.includes(entry)) {
      values.push(entry);
    }
  }
  return values.length > 0 ? values.join(", ") : null;
}

function fallbackSuggestion(rule) {
  return rule && rule.fix
    ? rule.fix
    : "Refactor this code path to satisfy the rule intent and architecture boundaries.";
}

function formatLocation(issue) {
  if (issue.file && issue.line) {
    return `${issue.file}:${issue.line}`;
  }
  return issue.file || null;
}

function indentBlock(text, spaces) {
  const prefix = " ".repeat(spaces);
  return String(text)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function getRule(projectRules, ruleId) {
  return projectRules.get(ruleId) || null;
}

function groupIssuesByRule(issues) {
  const groups = {};
  for (const issue of issues) {
    if (!groups[issue.ruleId]) {
      groups[issue.ruleId] = [];
    }
    groups[issue.ruleId].push(issue);
  }
  return groups;
}

async function maybeLoadProjectRules(cwd) {
  const configPath = path.join(cwd, ".ai-rules", "rules-config.json");
  const exists = await fileExists(configPath);
  if (!exists) {
    return new Map();
  }

  try {
    const config = await loadConfig(configPath);
    const rulesPath = path.join(cwd, ".ai-rules", config.rulesFile || ".ai-rules.md");
    const rules = await parseRules(rulesPath);
    return new Map(rules.map((rule) => [rule.id, rule]));
  } catch {
    return new Map();
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

module.exports = { runFix };
