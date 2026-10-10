const DEFAULTS = {
  compact: { maxEvidenceRules: 6, maxMatchesPerRule: 2, maxSnippetChars: 160 },
  balanced: { maxEvidenceRules: 12, maxMatchesPerRule: 3, maxSnippetChars: 240 },
  full: { maxEvidenceRules: Infinity, maxMatchesPerRule: Infinity, maxSnippetChars: Infinity },
};

function resolveContextOptions(input = {}) {
  const mode = input.mode || "balanced";
  if (!DEFAULTS[mode]) throw new Error("--context-mode must be compact, balanced, or full");
  const options = { ...DEFAULTS[mode], ...input, mode };
  for (const key of ["maxEvidenceRules", "maxMatchesPerRule", "maxSnippetChars"]) {
    const value = options[key];
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${key} must be a non-negative safe integer`);
    }
  }
  return options;
}

function parseContextOptions(argv) {
  const keys = {
    "--context-mode": "mode", "--rule": "rule", "--scope": "scope",
    "--max-evidence-rules": "maxEvidenceRules",
    "--max-matches-per-rule": "maxMatchesPerRule",
    "--max-snippet-chars": "maxSnippetChars",
  };
  const input = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = keys[argv[i]];
    if (!key) continue;
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argv[i - 1]}`);
    if (key.startsWith("max") && !/^\d+$/.test(value)) throw new Error(`${key} must be a non-negative integer`);
    input[key] = key.startsWith("max") ? Number(value) : value;
  }
  return resolveContextOptions(input);
}

function selectRules(rules, options) {
  const selected = rules.filter((rule) =>
    (!options.rule || rule.id === options.rule) && (!options.scope || rule.scope === options.scope)
  );
  if ((options.rule || options.scope) && !selected.length) {
    throw new Error("No enabled rules match --rule / --scope");
  }
  return selected;
}

function truncate(value, limit) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)} [truncated]` : text;
}

function budgetEvidence(evidence, rules, options) {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const severity = { FATAL: 4, ERROR: 3, WARN: 2, INFO: 1 };
  const relevant = evidence.filter((item) => byId.has(item.ruleId) && (options.mode === "full" || (item.matches || []).length));
  relevant.sort((a, b) => (severity[byId.get(b.ruleId).severity] || 0) - (severity[byId.get(a.ruleId).severity] || 0));
  const selected = relevant.slice(0, options.maxEvidenceRules);
  return {
    evidence: selected.map((item) => ({
      ...item,
      note: truncate(item.note, options.maxSnippetChars),
      matches: (item.matches || []).slice(0, options.maxMatchesPerRule).map((match) => ({
        ...match, snippet: truncate(match.snippet, options.maxSnippetChars),
      })),
    })),
    omittedRules: relevant.length - selected.length,
    omittedMatches: relevant.reduce((sum, item) => sum + (item.matches || []).length, 0) -
      selected.reduce((sum, item) => sum + Math.min((item.matches || []).length, options.maxMatchesPerRule), 0),
  };
}

function contextGuidance(options, command, omissions = "") {
  return [
    `Context mode: ${options.mode}; review scope: rule=${options.rule || "all"}, scope=${options.scope || "all"}.`,
    `Evidence budgets: rules=${options.maxEvidenceRules}, matches/rule=${options.maxMatchesPerRule}, snippet chars=${options.maxSnippetChars}. ${omissions}`,
    "The resolved config and rule catalog below already incorporate the project rule files. Use this representation initially; consult original config or rule files only to resolve a specific uncertainty rather than reading the entire rule system again.",
    "All rules in this review scope remain review obligations, including rules without local matches. Omitted evidence is not proof of safety; do not claim complete file coverage from this prompt alone.",
    `For an individual rule's full details and evidence, run: ${command} --rule <RULE_ID> --context-mode full. Read relevant source files and callers on demand; do not load all overlapping cache artifacts into context.`,
  ];
}

module.exports = { resolveContextOptions, parseContextOptions, selectRules, truncate, budgetEvidence, contextGuidance };
