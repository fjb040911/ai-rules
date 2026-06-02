const { getLogicArtifactNames } = require("./artifacts");

function buildLogicPrompt({ config, ruleIR, validator, logicContext, profile, localeMap, reportSchemaText }) {
  const prompt = resolvePromptConfig(config, localeMap);
  const activeRules = (ruleIR || []).filter((rule) => rule.enabled);
  const focus = resolveLogicFocus(config, profile);
  const artifactNames = getLogicArtifactNames(profile);

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
    `- review focus: ${formatList(focus.reviewFocus)}`,
    `- risk keywords: ${formatList(logicContext.riskKeywords)}`,
    `- likely high-risk files: ${formatList(logicContext.highRiskFiles)}`,
    `- validator local-evidence rules: ${validator.summary.localEvidenceRules}`,
    `- validator ai-review rules: ${validator.summary.aiReviewRules}`,
    `- validator candidate violations: ${validator.summary.validatorViolationCount}`,
    "",
    "High-risk rules to use as review anchors:",
    ...buildRuleLines(activeRules),
    "",
    "Validator candidates to inspect carefully:",
    ...buildValidatorLines(validator),
    "",
    "Output requirements:",
    `Return strict JSON only with shape: ${reportSchemaText}`,
    `- Save the final JSON result as ${artifactNames.outputFile} in the project root after completing the logic inspection.`,
    `- Focus on ${focus.outputFocus}.`,
    "- Prefer concrete cross-file reasoning over generic framework advice.",
    "- If no material logic risks are found, return an empty risks array.",
  ];

  return sections.join("\n");
}

function resolvePromptConfig(config, localeMap) {
  const templates = (config.prompt && config.prompt.promptTemplates) || {};
  const stack = (config && config.stack) || "unknown";
  const isCpp = stack === "c-cpp";
  return {
    logicSystem:
      templates.logicSystem ||
      resolve(localeMap, isCpp ? "prompt.logic.c-cpp.system" : "prompt.logic.system"),
    logicUser:
      templates.logicUser ||
      resolve(localeMap, isCpp ? "prompt.logic.c-cpp.user" : "prompt.logic.user"),
  };
}

function resolveLogicFocus(config, profile) {
  const stack = (config && config.stack) || "unknown";
  if (profile === "native" || stack === "c-cpp") {
    return {
      reviewFocus: [
        "resource ownership and lifetime transitions",
        "critical return values and error propagation",
        "lock discipline and shared-state mutation protocols",
        "parser or decoder bounds/state validation",
        "privileged file/process/socket trust boundaries",
        "partial cleanup and rollback consistency",
      ],
      outputFocus:
        "native-code vulnerabilities such as ownership/lifetime mistakes, unchecked critical returns, inconsistent lock or atomic protocols, parser length/offset/state validation gaps, privileged-operation trust-boundary failures, and partial cleanup or rollback holes",
    };
  }

  if (profile === "model") {
    return {
      reviewFocus: [
        "model input shape, dtype, device, and batch contracts",
        "precision mode, device fallback, and runtime drift",
        "checkpoint strictness, remap, and compatibility handling",
        "train/eval mode, stochastic layers, and seed control",
        "tokenizer, label map, threshold, and postprocess consistency",
      ],
      outputFocus:
        "model-pipeline vulnerabilities such as shape or dtype drift, silent precision/device fallback, checkpoint compatibility mistakes, train/eval mode confusion, stochastic-state leakage, and evaluation or postprocess contract mismatches",
    };
  }

  return {
    reviewFocus: [
      "authorization and ownership checks",
      "unsafe state transitions",
      "idempotency and replay protection",
      "tenant isolation and trust boundaries",
      "workflow bypasses across validation and persistence",
    ],
    outputFocus:
      "business-logic vulnerabilities such as authorization gaps, ownership checks, invalid state transitions, idempotency holes, tenant-isolation mistakes, trust-boundary failures, and workflow bypasses",
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
