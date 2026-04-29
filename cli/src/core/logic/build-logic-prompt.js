function buildLogicPrompt({ config, ruleIR, validator, logicContext, localeMap, reportSchemaText }) {
  const prompt = resolvePromptConfig(config, localeMap);
  const activeRules = (ruleIR || []).filter((rule) => rule.enabled);

  const sections = [
    prompt.logicSystem,
    "",
    prompt.logicUser,
    "",
    "Project logic risk summary:",
    `- stack: ${config.stack || "unknown"}`,
    `- severity threshold: ${config.severityThreshold || "INFO"}`,
    `- include paths: ${formatList((config.detectOptions && config.detectOptions.include) || [])}`,
    `- exclude paths: ${formatList((config.detectOptions && config.detectOptions.exclude) || [])}`,
    `- risk keywords: ${formatList(logicContext.riskKeywords)}`,
    `- likely business files: ${formatList(logicContext.highRiskFiles)}`,
    `- validator local-evidence rules: ${validator.summary.localEvidenceRules}`,
    `- validator ai-review rules: ${validator.summary.aiReviewRules}`,
    `- validator candidate violations: ${validator.summary.validatorViolationCount}`,
    "",
    "Business-logic focused rules:",
    ...buildRuleLines(activeRules),
    "",
    "Validator candidates to inspect carefully:",
    ...buildValidatorLines(validator),
    "",
    "Output requirements:",
    `Return strict JSON only with shape: ${reportSchemaText}`,
    "- Save the final JSON result as ai-logic-report.json in the project root after completing the logic inspection.",
    "- Focus on business-logic vulnerabilities such as authorization gaps, ownership checks, invalid state transitions, idempotency holes, tenant-isolation mistakes, trust-boundary failures, and workflow bypasses.",
    "- Prefer concrete cross-file reasoning over generic framework advice.",
    "- If no material logic risks are found, return an empty risks array.",
  ];

  return sections.join("\n");
}

function resolvePromptConfig(config, localeMap) {
  const templates = (config.prompt && config.prompt.promptTemplates) || {};
  return {
    logicSystem: templates.logicSystem || resolve(localeMap, "prompt.logic.system"),
    logicUser: templates.logicUser || resolve(localeMap, "prompt.logic.user"),
  };
}

function buildRuleLines(rules) {
  if (!rules.length) {
    return ["- (none)"];
  }

  return rules.map((rule) => {
    const hints = [];
    if (rule.detectKind) {
      hints.push(`detect=${rule.detectKind}`);
    }
    if (rule.validator && rule.validator.mode) {
      hints.push(`validator=${rule.validator.mode}`);
    }
    return `- ${rule.id} [${rule.severity}/${rule.scope}] ${rule.intent} (${hints.join(", ")})`;
  });
}

function buildValidatorLines(validator) {
  const lines = [];
  const results = (validator && validator.results) || [];
  const violations = (validator && validator.violations) || [];
  const violationByRule = new Map();

  for (const violation of violations) {
    if (!violationByRule.has(violation.ruleId)) {
      violationByRule.set(violation.ruleId, []);
    }
    violationByRule.get(violation.ruleId).push(violation);
  }

  for (const result of results) {
    lines.push(
      `- ${result.ruleId}: decision=${result.decision}, mode=${result.evidenceMode || "n/a"}, evidenceCount=${result.evidenceCount || 0}`
    );
    for (const violation of (violationByRule.get(result.ruleId) || []).slice(0, 3)) {
      lines.push(
        `  candidate: ${violation.issueId} files=${formatList(violation.files || [])} evidence=${formatList((violation.evidence && violation.evidence.evidenceIds) || [])}`
      );
      lines.push(`  description: ${violation.description}`);
    }
  }

  return lines.length > 0 ? lines : ["- (none)"];
}

function formatList(values) {
  if (!values || values.length === 0) {
    return "(none)";
  }
  return values.join(", ");
}

function resolve(localeMap, key) {
  return localeMap[key] || key;
}

module.exports = {
  buildLogicPrompt,
};
