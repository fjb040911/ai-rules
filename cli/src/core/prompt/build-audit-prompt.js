function buildAuditPrompt({ config, rules, evidence, localeMap, reportSchemaText }) {
  const promptConfig = resolvePromptConfig(config, localeMap);
  const enabledRules = new Set(config.enabledRuleIds || []);
  const activeRules = rules.filter((rule) => enabledRules.has(rule.id));
  const evidenceByRule = new Map(evidence.map((item) => [item.ruleId, item]));

  const sections = [
    promptConfig.auditSystem,
    "",
    promptConfig.auditUser,
    "",
    "Project config summary:",
    `- stack: ${config.stack || "unknown"}`,
    `- severity threshold: ${config.severityThreshold || "INFO"}`,
    `- include paths: ${formatList((config.detectOptions && config.detectOptions.include) || [])}`,
    `- exclude paths: ${formatList((config.detectOptions && config.detectOptions.exclude) || [])}`,
    `- scopes: ${formatList(config.scopes || [])}`,
    `- thresholds: ${formatObject(config.thresholds)}`,
    `- exception rules: ${formatExceptionSummary(config.exceptions)}`,
    "",
    "Resolved rules:",
    ...buildRuleSections(activeRules),
    "",
    "Local evidence candidates:",
    ...buildEvidenceSections(activeRules, evidenceByRule),
    "",
    "Output requirements:",
    `Return strict JSON only with shape: ${reportSchemaText || "{}"}`,
    "- Only report violations at or above the configured severity threshold.",
    "- Each issue must reference exactly one ruleId.",
    "- Use local evidence when available, but do not fabricate certainty if evidence is weak.",
    "- If no violations are found, return an empty violations array.",
  ];

  return sections.join("\n");
}

function resolvePromptConfig(config, localeMap) {
  if (config.prompt && config.prompt.promptTemplates) {
    return config.prompt.promptTemplates;
  }

  const keys = (config.prompt && config.prompt.promptTemplateKeys) || {};
  return {
    auditSystem: resolve(localeMap, keys.auditSystem || "prompt.audit.system"),
    auditUser: resolve(localeMap, keys.auditUser || "prompt.audit.user"),
  };
}

function buildRuleSections(rules) {
  const lines = [];
  for (const rule of rules) {
    lines.push(`### ${rule.id}`);
    lines.push(`- severity: ${rule.severity}`);
    lines.push(`- scope: ${rule.scope}`);
    lines.push(`- intent: ${rule.intent}`);
    lines.push(`- fix direction: ${rule.fix}`);
    lines.push(`- detect: ${formatDetect(rule)}`);
    lines.push(`- requirement: ${rule.prompt.requirement}`);
    lines.push(`- violation wording: ${rule.prompt.violation}`);
    lines.push(`- solution wording: ${rule.prompt.solution}`);
    lines.push(`- context assets: ${formatList(rule.context || [])}`);
  }
  return lines;
}

function buildEvidenceSections(rules, evidenceByRule) {
  const lines = [];
  for (const rule of rules) {
    const item = evidenceByRule.get(rule.id);
    if (!item) {
      lines.push(`- ${rule.id}: no evidence collected`);
      continue;
    }

    lines.push(`- ${rule.id} (${item.mode}, totalMatches=${item.totalMatches})`);
    if (item.note) {
      lines.push(`  note: ${item.note}`);
    }
    if (item.exceptionPatterns && item.exceptionPatterns.length > 0) {
      lines.push(`  exceptions: ${item.exceptionPatterns.join(", ")}`);
    }
    if (item.suppressedFileCount > 0) {
      lines.push(`  suppressed files: ${item.suppressedFileCount}`);
    }
    if (!item.matches.length) {
      lines.push("  matches: none");
      continue;
    }
    for (const match of item.matches.slice(0, 5)) {
      const location = match.line ? `${match.file}:${match.line}` : match.file;
      lines.push(`  - ${location}`);
      lines.push(`    snippet: ${match.snippet}`);
    }
  }
  return lines;
}

function formatDetect(rule) {
  if (!rule.detect || Object.keys(rule.detect).length === 0) {
    return "none";
  }

  const entries = Object.entries(rule.detect).map(([key, value]) => `${key}=${value}`);
  return entries.join(", ");
}

function formatList(items) {
  if (!items || items.length === 0) {
    return "(none)";
  }
  return items.join(", ");
}

function formatObject(value) {
  if (!value || Object.keys(value).length === 0) {
    return "(none)";
  }
  return Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join(", ");
}

function formatExceptionSummary(exceptions) {
  if (!exceptions || Object.keys(exceptions).length === 0) {
    return "(none)";
  }
  return Object.entries(exceptions)
    .map(([rulePattern, files]) => `${rulePattern}:${files.length}`)
    .join(", ");
}

function resolve(localeMap, key) {
  return localeMap[key] || key;
}

module.exports = {
  buildAuditPrompt,
};
