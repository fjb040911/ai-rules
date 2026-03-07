const path = require("path");
const fs = require("fs/promises");
const clipboardy = require("clipboardy");
const { readJson } = require("./utils/fs");

const writeClipboard =
  (clipboardy.write && clipboardy.write.bind(clipboardy)) ||
  (clipboardy.default && clipboardy.default.write
    ? clipboardy.default.write.bind(clipboardy.default)
    : null);

async function runFix(argv) {
  const issueId = parseIssueIdArg(argv);
  const ruleId = parseIdArg(argv);
  if (!issueId && !ruleId) {
    process.stderr.write("Missing required identifier. Use --issueId <issue_id> or --id <rule_id>.\n");
    process.stderr.write("Usage: ai-law fix --issueId <issue_id> | --id <rule_id>\n");
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const reportPath = path.join(cwd, "ai-rule-report.json");
  const exists = await fileExists(reportPath);
  if (!exists) {
    process.stderr.write(
      "ai-rule-report.json not found. Run: ai-law audit\n"
    );
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    report = await readJson(reportPath);
  } catch (err) {
    process.stderr.write(`Failed to read report: ${String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const issue = issueId
    ? findIssueByIssueId(report, issueId)
    : selectBestIssue(findIssuesByRuleId(report, ruleId));

  if (!issue) {
    if (issueId) {
      process.stderr.write(`No issue found for issueId: ${issueId}\n`);
    } else {
      process.stderr.write(`No fix prompt found for rule id: ${ruleId}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const targetRuleId = ruleId || issue.ruleId || issue.rule_id || issue.id || issue.code;
  let prompt = extractPrompt(issue);
  if (!prompt) {
    prompt = buildFallbackPrompt(issue, targetRuleId || "UNKNOWN-RULE");
    process.stderr.write(
      `Repair prompt not found in report. Generated a fallback prompt.\n`
    );
  }

  process.stdout.write(prompt + "\n");
  try {
    if (!writeClipboard) {
      throw new Error("clipboardy.write is not available");
    }
    await writeClipboard(prompt);
    process.stdout.write("Prompt copied to clipboard.\n");
  } catch (err) {
    process.stderr.write(`Clipboard copy failed: ${String(err)}\n`);
  }
}

function parseIdArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--id" || arg === "-i") {
      return argv[i + 1];
    }
  }
  return null;
}

function parseIssueIdArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--issueId") {
      return argv[i + 1];
    }
  }
  return null;
}

function findIssueByIssueId(report, issueId) {
  const candidates = [];
  if (Array.isArray(report)) {
    candidates.push(...report);
  }
  if (Array.isArray(report.violations)) {
    candidates.push(...report.violations);
  }
  if (Array.isArray(report.issues)) {
    candidates.push(...report.issues);
  }
  if (Array.isArray(report.results)) {
    candidates.push(...report.results);
  }

  return candidates.find((item) => {
    const id = item.issueId || item.issue_id;
    return id === issueId;
  });
}

function findIssuesByRuleId(report, ruleId) {
  const candidates = [];
  if (Array.isArray(report)) {
    candidates.push(...report);
  }
  if (Array.isArray(report.violations)) {
    candidates.push(...report.violations);
  }
  if (Array.isArray(report.issues)) {
    candidates.push(...report.issues);
  }
  if (Array.isArray(report.results)) {
    candidates.push(...report.results);
  }

  return candidates.filter((item) => {
    const id = item.ruleId || item.rule_id || item.id || item.code;
    return id === ruleId;
  });
}

function selectBestIssue(issues) {
  const withPrompt = issues.find((issue) => extractPrompt(issue));
  return withPrompt || issues[0];
}

function extractPrompt(issue) {
  if (!issue || typeof issue !== "object") {
    return null;
  }
  if (typeof issue.repairPrompt === "string") {
    return issue.repairPrompt;
  }
  if (typeof issue.fixPrompt === "string") {
    return issue.fixPrompt;
  }
  if (typeof issue.prompt === "string") {
    return issue.prompt;
  }
  if (issue.prompt && typeof issue.prompt.repair === "string") {
    return issue.prompt.repair;
  }
  if (issue.repair && typeof issue.repair.prompt === "string") {
    return issue.repair.prompt;
  }
  if (typeof issue.suggestion === "string") {
    return issue.suggestion;
  }
  return null;
}

function buildFallbackPrompt(issue, ruleId) {
  const location = formatLocation(issue);
  const description =
    issue.description ||
    issue.message ||
    issue.reason ||
    "No detailed description was provided in the report.";
  const suggestion =
    issue.fixSuggestion ||
    issue.suggestion ||
    (issue.repair && issue.repair.suggestion) ||
    "Refactor this code path to satisfy the rule intent and architecture boundaries.";
  const context = extractContext(issue);

  return [
    `You violated rule ${ruleId}.`,
    location ? `Location: ${location}.` : null,
    `Issue: ${description}`,
    `Task: Provide a minimal patch that fixes this violation and keeps existing architecture boundaries intact.`,
    `Expected output: step-by-step fix plan + patch-ready code edits.`,
    `Suggested direction: ${suggestion}`,
    context ? `Available context: ${context}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatLocation(issue) {
  const file = issue.file || issue.filePath || issue.path;
  const line = issue.line || issue.lineNumber || issue.row;
  if (file && line) {
    return `${file}:${line}`;
  }
  if (file) {
    return file;
  }
  return null;
}

function extractContext(issue) {
  if (Array.isArray(issue.context)) {
    return issue.context.join(", ");
  }
  if (Array.isArray(issue.assets)) {
    return issue.assets.join(", ");
  }
  if (typeof issue.context === "string") {
    return issue.context;
  }
  return null;
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
