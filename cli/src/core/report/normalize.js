function normalizeReport(rawReport) {
  const rawViolations = extractViolations(rawReport);
  const violations = rawViolations.map(normalizeViolation);
  const findings = validateNormalizedViolations(violations);

  return {
    report: {
      version: inferVersion(rawReport),
      generatedAt: inferGeneratedAt(rawReport),
      project: inferProject(rawReport),
      summary: summarize(violations),
      violations,
    },
    findings,
  };
}

function extractViolations(rawReport) {
  if (Array.isArray(rawReport)) {
    return rawReport;
  }
  if (rawReport && Array.isArray(rawReport.violations)) {
    return rawReport.violations;
  }
  if (rawReport && Array.isArray(rawReport.issues)) {
    return rawReport.issues;
  }
  if (rawReport && Array.isArray(rawReport.results)) {
    return rawReport.results;
  }
  return [];
}

function normalizeViolation(issue) {
  const matchedBy = inferMatchedBy(issue);
  return {
    issueId: issue.issueId || issue.issue_id || "UNKNOWN-ISSUE",
    ruleId: issue.ruleId || issue.rule_id || issue.id || issue.code || "UNKNOWN-RULE",
    severity: normalizeSeverity(issue.severity),
    confidence: normalizeConfidence(issue.confidence),
    file: issue.file || issue.filePath || issue.path || null,
    line: normalizeLine(issue.line || issue.lineNumber || issue.row),
    snippet: issue.snippet || issue.codeSnippet || null,
    description:
      issue.description ||
      issue.message ||
      issue.reason ||
      "No detailed description was provided in the report.",
    fixSuggestion:
      issue.fixSuggestion ||
      issue.suggestion ||
      (issue.repair && issue.repair.suggestion) ||
      null,
    repairPrompt: extractPrompt(issue),
    evidence: {
      source: (issue.evidence && issue.evidence.source) || inferEvidenceSource(matchedBy),
      matchedBy,
    },
    context: normalizeContext(issue),
  };
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
  return null;
}

function normalizeContext(issue) {
  if (Array.isArray(issue.context)) {
    return issue.context;
  }
  if (Array.isArray(issue.assets)) {
    return issue.assets;
  }
  if (typeof issue.context === "string") {
    return [issue.context];
  }
  return [];
}

function inferVersion(rawReport) {
  return rawReport && typeof rawReport.version === "string" ? rawReport.version : "1.1";
}

function inferGeneratedAt(rawReport) {
  return rawReport && typeof rawReport.generatedAt === "string" ? rawReport.generatedAt : null;
}

function inferProject(rawReport) {
  return rawReport && rawReport.project && typeof rawReport.project === "object"
    ? rawReport.project
    : {};
}

function summarize(violations) {
  const summary = { total: violations.length, fatal: 0, warn: 0, info: 0 };
  for (const issue of violations) {
    if (issue.severity === "FATAL") {
      summary.fatal += 1;
    } else if (issue.severity === "WARN") {
      summary.warn += 1;
    } else if (issue.severity === "INFO") {
      summary.info += 1;
    }
  }
  return summary;
}

function validateNormalizedViolations(violations) {
  const findings = [];
  const seenIssueIds = new Set();

  for (const issue of violations) {
    if (!issue.issueId || issue.issueId === "UNKNOWN-ISSUE") {
      findings.push(error(`Violation for rule '${issue.ruleId}' is missing issueId.`));
    } else if (seenIssueIds.has(issue.issueId)) {
      findings.push(error(`Duplicate issueId '${issue.issueId}' found in report.`));
    } else {
      seenIssueIds.add(issue.issueId);
    }

    if (!issue.ruleId || issue.ruleId === "UNKNOWN-RULE") {
      findings.push(error(`Violation '${issue.issueId}' is missing ruleId.`));
    }

    if (!["FATAL", "WARN", "INFO"].includes(issue.severity)) {
      findings.push(error(`Violation '${issue.issueId}' has invalid severity '${issue.severity}'.`));
    }

    if (!issue.repairPrompt) {
      findings.push(warn(`Violation '${issue.issueId}' is missing repairPrompt.`));
    }
  }

  return findings;
}

function normalizeSeverity(value) {
  if (typeof value !== "string") {
    return "INFO";
  }
  const normalized = value.toUpperCase();
  if (normalized === "ERROR") {
    return "FATAL";
  }
  if (normalized === "WARNING") {
    return "WARN";
  }
  if (["FATAL", "WARN", "INFO"].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function normalizeConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeLine(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function inferMatchedBy(issue) {
  if (issue.evidence && typeof issue.evidence.matchedBy === "string") {
    return issue.evidence.matchedBy;
  }
  if (typeof issue.detect === "string") {
    return issue.detect;
  }
  return "unknown";
}

function inferEvidenceSource(matchedBy) {
  if (matchedBy === "detect.regex") {
    return "local-regex";
  }
  if (matchedBy === "detect.import" || matchedBy === "detect.include") {
    return "local-import";
  }
  return "ai-only";
}

function error(message) {
  return { level: "error", message };
}

function warn(message) {
  return { level: "warn", message };
}

module.exports = {
  normalizeReport,
};
