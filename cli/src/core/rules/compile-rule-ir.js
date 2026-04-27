function compileRulesToIR({ config, rules }) {
  const enabledRuleIds = new Set((config && config.enabledRuleIds) || []);

  return rules.map((rule) => compileRuleToIR({ config, rule, enabledRuleIds }));
}

function compileRuleToIR({ config, rule, enabledRuleIds }) {
  const detectKind = rule.detectKind || firstDetectKey(rule.detect);
  const validatorMode = inferValidatorMode(detectKind);
  const executionPhase = inferExecutionPhase(detectKind);
  const localEvidence = supportsLocalEvidence(detectKind);

  return {
    version: "0.1",
    id: rule.id,
    ruleId: rule.id,
    enabled: enabledRuleIds.has(rule.id),
    stack: (config && config.stack) || "unknown",
    detectKind,
    severity: rule.severity,
    scope: rule.scope,
    intent: rule.intent,
    fix: rule.fix,
    prompt: { ...(rule.prompt || {}) },
    context: [...(rule.context || [])],
    detect: { ...(rule.detect || {}) },
    metadata: {
      severity: rule.severity,
      scope: rule.scope,
      intent: rule.intent,
      enabled: enabledRuleIds.has(rule.id),
      stack: (config && config.stack) || "unknown",
    },
    execution: {
      phase: executionPhase,
      localEvidence,
      aiRequired: !localEvidence || detectKind === "semantic",
    },
    validator: {
      mode: validatorMode,
      localEvidence,
      evidenceSourceHint: inferEvidenceSourceHint(detectKind),
    },
    repair: {
      fix: rule.fix,
      requirement: rule.prompt && rule.prompt.requirement,
      violation: rule.prompt && rule.prompt.violation,
      solution: rule.prompt && rule.prompt.solution,
      contextAssets: [...(rule.context || [])],
    },
  };
}

function inferExecutionPhase(detectKind) {
  if (detectKind === "semantic") {
    return "post-generation-ai-review";
  }
  return "post-generation-validation";
}

function inferValidatorMode(detectKind) {
  if (detectKind === "semantic") {
    return "ai-guided";
  }
  if (detectKind === "ast") {
    return "hybrid";
  }
  return "local";
}

function supportsLocalEvidence(detectKind) {
  return ["regex", "import", "include", "count", "ast"].includes(detectKind);
}

function inferEvidenceSourceHint(detectKind) {
  if (detectKind === "regex") {
    return "local-regex";
  }
  if (detectKind === "import" || detectKind === "include") {
    return "local-import";
  }
  if (detectKind === "count") {
    return "local-count";
  }
  if (detectKind === "ast") {
    return "local-ast-or-ai";
  }
  return "ai-only";
}

function firstDetectKey(detect) {
  const keys = Object.keys(detect || {});
  return keys.length > 0 ? keys[0] : null;
}

module.exports = {
  compileRulesToIR,
  compileRuleToIR,
};
