const { resolveContextOptions, selectRules, budgetEvidence, contextGuidance } = require("./context-budget");

function buildAuditPrompt({ config, rules, evidence, localeMap, reportSchemaText, contextOptions }) {
  const options = resolveContextOptions(contextOptions);
  const promptConfig = resolvePromptConfig(config, localeMap);
  const enabledRules = new Set(config.enabledRuleIds || []);
  const activeRules = selectRules(rules.filter((rule) => enabledRules.has(rule.id)), options);
  const budget = budgetEvidence(evidence, activeRules, options);
  const evidenceByRule = new Map(budget.evidence.map((item) => [item.ruleId, item]));
  const detailedIds = new Set(budget.evidence.map((item) => item.ruleId));

  const sections = [
    promptConfig.auditSystem,
    "",
    promptConfig.auditUser,
    "",
    ...contextGuidance(options, "ai-law audit", `Omitted evidence rules=${budget.omittedRules}, matches=${budget.omittedMatches}.`),
    "",
    "Project config summary:",
    `- stack: ${config.stack || "unknown"}`,
    `- severity threshold: ${config.severityThreshold || "INFO"}`,
    `- include paths: ${formatList((config.detectOptions && config.detectOptions.include) || [])}`,
    `- exclude paths: ${formatList((config.detectOptions && config.detectOptions.exclude) || [])}`,
    `- scopes: ${formatList(config.scopes || [])}`,
    `- thresholds: ${formatObject(config.thresholds)}`,
    `- path aliases: ${JSON.stringify(config.pathAliases || {})}`,
    `- exception rules: ${formatExceptionSummary(config.exceptions)}`,
    `- ast backend: ${formatAstConfig(config.resolvedAstConfig)}`,
    "",
    "Resolved rules:",
    ...buildRuleSections(activeRules, options, detailedIds),
    "",
    "Local evidence candidates:",
    ...buildEvidenceSections(options.mode === "full" ? activeRules : activeRules.filter((rule) => evidenceByRule.has(rule.id)), evidenceByRule),
    "",
    "Output requirements:",
    `Return strict JSON only with shape: ${reportSchemaText || "{}"}`,
    "- Save the final JSON result as ai-rule-report.json in the project root after completing the audit.",
    "- AST-backed local evidence, when present, was produced by the configured parser backend and should be treated as strong structural evidence rather than final judgment by itself.",
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

function buildRuleSections(rules, options, detailedIds) {
  const lines = [];
  for (const rule of rules) {
    lines.push(`### ${rule.id}`);
    if (options.mode !== "full" && !(options.mode === "balanced" && detailedIds.has(rule.id))) {
      lines.push(`- ${rule.severity}/${rule.scope}: ${(rule.prompt && rule.prompt.requirement) || rule.intent}`);
      if ((rule.context || []).length) lines.push(`- context assets: ${formatList(rule.context)}`);
      continue;
    }
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

    lines.push(`- ${rule.id} (${item.mode}, totalMatches=${item.totalMatches}, evidenceId=${item.evidenceId || "n/a"})`);
    if (item.strategy) {
      lines.push(`  strategy: ${item.strategy}`);
    }
    if (typeof item.confidence === "number") {
      lines.push(`  confidence: ${item.confidence.toFixed(2)}`);
    }
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
    for (const match of item.matches) {
      const location = match.line ? `${match.file}:${match.line}` : match.file;
      lines.push(`  - ${location}${match.matchId ? ` [${match.matchId}]` : ""}`);
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

function formatAstConfig(ast) {
  if (!ast || !ast.provider) {
    return "(none)";
  }

  const parts = [`provider=${ast.provider}`];
  if (ast.target) {
    parts.push(`target=${ast.target}`);
  }
  if (ast.scriptParser) {
    parts.push(`scriptParser=${ast.scriptParser}`);
  }
  if (ast.parserOptions && ast.parserOptions.plugins && ast.parserOptions.plugins.length > 0) {
    parts.push(`plugins=${ast.parserOptions.plugins.join("|")}`);
  }
  if (Array.isArray(ast.sources) && ast.sources.length > 0) {
    parts.push(`sources=${ast.sources.join("|")}`);
  }
  return parts.join(", ");
}

function resolve(localeMap, key) {
  return localeMap[key] || key;
}

module.exports = {
  buildAuditPrompt,
};
