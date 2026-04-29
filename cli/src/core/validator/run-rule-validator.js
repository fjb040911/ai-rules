const { collectEvidence } = require("../evidence/collect");

async function runRuleValidator({ cwd, config, rules, ruleIR }) {
  const evidence = await collectEvidence({ cwd, config, rules });
  const evidenceByRuleId = new Map(evidence.map((entry) => [entry.ruleId, entry]));
  const findings = [];
  const results = (ruleIR || []).map((rule) => {
    const item = evidenceByRuleId.get(rule.id);
    const enabled = rule.enabled !== false;

    if (!enabled) {
      return {
        ruleId: rule.id,
        enabled: false,
        validatorMode: rule.validator && rule.validator.mode,
        decision: "skipped",
        evidenceMode: item ? item.mode : null,
        evidenceCount: item ? item.totalMatches || 0 : 0,
      };
    }

    if (!item || item.mode === "ai-only") {
      if (item && item.note) {
        findings.push(info(`Rule '${rule.id}' requires AI review: ${item.note}`));
      }
      return {
        ruleId: rule.id,
        enabled: true,
        validatorMode: rule.validator && rule.validator.mode,
        decision: "ai-review",
        evidenceMode: item ? item.mode : null,
        evidenceCount: 0,
        note: item ? item.note || null : null,
      };
    }

    return {
      ruleId: rule.id,
      enabled: true,
      validatorMode: rule.validator && rule.validator.mode,
      decision: "local-evidence",
      evidenceMode: item.mode,
      evidenceCount: item.totalMatches || 0,
      confidence: item.confidence == null ? null : item.confidence,
    };
  });
  const violations = buildValidatorViolations(results, evidenceByRuleId, ruleIR || []);

  return {
    version: "0.1",
    evidence,
    findings,
    results,
    violations,
    summary: summarizeResults(results, violations),
  };
}

function summarizeResults(results, violations) {
  return results.reduce(
    (summary, result) => {
      if (result.decision === "local-evidence") {
        summary.localEvidenceRules += 1;
        summary.totalEvidenceMatches += result.evidenceCount || 0;
      } else if (result.decision === "ai-review") {
        summary.aiReviewRules += 1;
      } else if (result.decision === "skipped") {
        summary.skippedRules += 1;
      }
      return summary;
    },
    {
      localEvidenceRules: 0,
      aiReviewRules: 0,
      skippedRules: 0,
      totalEvidenceMatches: 0,
      validatorViolationCount: Array.isArray(violations) ? violations.length : 0,
    }
  );
}

function buildValidatorViolations(results, evidenceByRuleId, ruleIR) {
  const violations = [];
  const ruleById = new Map((ruleIR || []).map((rule) => [rule.id, rule]));

  for (const result of results) {
    if (result.decision !== "local-evidence") {
      continue;
    }

    const rule = ruleById.get(result.ruleId);
    const evidence = evidenceByRuleId.get(result.ruleId);
    if (!rule || !evidence) {
      continue;
    }

    for (const [index, match] of (evidence.matches || []).entries()) {
      violations.push({
        issueId: buildValidatorIssueId(rule.id, index),
        ruleId: rule.id,
        severity: rule.severity || (rule.metadata && rule.metadata.severity) || "INFO",
        confidence: evidence.confidence == null ? null : evidence.confidence,
        files: [match.file || match.filePath || null].filter(Boolean),
        file: match.file || match.filePath || null,
        line: typeof match.line === "number" ? match.line : null,
        snippet: match.snippet || null,
        description: buildViolationDescription(rule),
        fixSuggestion: rule.fix || (rule.repair && rule.repair.fix) || null,
        repairPrompt: buildRepairPrompt(rule),
        evidence: {
          source: evidence.mode,
          matchedBy: inferMatchedBy(rule),
          strategy: evidence.strategy || null,
          confidence: evidence.confidence == null ? null : evidence.confidence,
          evidenceId: evidence.evidenceId || null,
          evidenceIds: [evidence.evidenceId, match.matchId].filter(Boolean),
        },
        context: [...((rule.repair && rule.repair.contextAssets) || rule.context || [])],
      });
    }
  }

  return violations;
}

function buildValidatorIssueId(ruleId, index) {
  return `VAL-${ruleId}-${String(index + 1).padStart(3, "0")}`;
}

function buildViolationDescription(rule) {
  return (
    (rule.prompt && rule.prompt.violation) ||
    (rule.metadata && rule.metadata.intent) ||
    rule.intent ||
    "Validator detected a candidate local rule violation."
  );
}

function buildRepairPrompt(rule) {
  return [
    rule && rule.intent ? `Rule intent: ${rule.intent}` : null,
    rule && rule.prompt && rule.prompt.requirement ? `Requirement: ${rule.prompt.requirement}` : null,
    rule && rule.fix ? `Fix guidance: ${rule.fix}` : null,
    "Task: Produce a minimal patch that resolves the violation without changing unrelated behavior.",
  ]
    .filter(Boolean)
    .join("\n");
}

function inferMatchedBy(rule) {
  if (rule && rule.detectKind) {
    return `detect.${rule.detectKind}`;
  }
  return "unknown";
}

function info(message) {
  return { level: "info", message };
}

module.exports = {
  runRuleValidator,
};
