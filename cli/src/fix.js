const path = require("path");
const fs = require("fs/promises");
const { readJson } = require("./utils/fs");
const { writeOutput } = require("./utils/output");
const { loadRuleContext } = require("./core/rules/load-rule-context");
const { normalizeReport } = require("./core/report/normalize");
const { loadValidatorArtifacts } = require("./core/validator/load-validator-artifacts");

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
    process.stderr.write("ai-rule-report.json not found.\n");
    process.stderr.write("Run: ai-law audit\n");
    process.stderr.write("Then save your AI audit result as ai-rule-report.json in the project root.\n");
    process.stderr.write("A starter template is available at: .ai-rules/cache/ai-rule-report.template.json\n");
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

  const validatorArtifacts = await loadValidatorArtifacts({ cwd });
  const normalized = normalizeReport(rawReport, validatorArtifacts);
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
    const issues = sortIssues(findAllIssues(report));
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
  const orderedIssues = sortIssues(issues);
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

  for (const issue of orderedIssues) {
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
      if (issue.evidence.evidenceIds && issue.evidence.evidenceIds.length > 0) {
        lines.push(`  Evidence refs: ${issue.evidence.evidenceIds.join(", ")}`);
      }
    }
    lines.push("  Repair prompt:");
    lines.push(indentBlock(prompt, 4));
  }

  return lines.join("\n");
}

function buildAggregateAllPrompt(issues, projectRules, groupByRule) {
  if (groupByRule) {
    return Object.entries(groupIssuesByRule(sortIssues(issues)))
      .sort(([leftRuleId, leftIssues], [rightRuleId, rightIssues]) => {
        return compareIssues(leftIssues[0], rightIssues[0]) || leftRuleId.localeCompare(rightRuleId);
      })
      .map(([ruleId, group]) => buildAggregateRulePrompt(group, ruleId, projectRules))
      .join("\n\n");
  }

  const orderedIssues = sortIssues(issues);
  const lines = [
    "You have multiple rule violations in this report.",
    "Task: Fix all violations across all rules with minimal, safe edits.",
    "Expected output: short fix plan + grouped patch-ready code edits + tests when needed.",
    "",
    "Violations:",
  ];

  for (const issue of orderedIssues) {
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
    if (issue.evidence && issue.evidence.evidenceIds && issue.evidence.evidenceIds.length > 0) {
      lines.push(`  Evidence refs: ${issue.evidence.evidenceIds.join(", ")}`);
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

function sortIssues(issues) {
  return [...issues].sort(compareIssues);
}

function compareIssues(left, right) {
  return (
    severityRank(left.severity) - severityRank(right.severity) ||
    String(left.file || "").localeCompare(String(right.file || "")) ||
    ((left.line || Number.MAX_SAFE_INTEGER) - (right.line || Number.MAX_SAFE_INTEGER)) ||
    String(left.ruleId || "").localeCompare(String(right.ruleId || "")) ||
    String(left.issueId || "").localeCompare(String(right.issueId || ""))
  );
}

function severityRank(severity) {
  if (severity === "FATAL") {
    return 0;
  }
  if (severity === "WARN") {
    return 1;
  }
  return 2;
}

async function maybeLoadProjectRules(cwd) {
  const configPath = path.join(cwd, ".ai-rules", "rules-config.json");
  const exists = await fileExists(configPath);
  if (!exists) {
    return new Map();
  }

  try {
    const { ruleIR } = await loadRuleContext({ cwd, configPath });
    return new Map(ruleIR.map((rule) => [rule.id, rule]));
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
