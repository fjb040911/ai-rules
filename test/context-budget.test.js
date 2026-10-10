const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAuditPrompt } = require("../cli/src/core/prompt/build-audit-prompt");
const { buildLogicPrompt } = require("../cli/src/core/logic/build-logic-prompt");
const { parseContextOptions, budgetEvidence, resolveContextOptions } = require("../cli/src/core/prompt/context-budget");

function fixture() {
  const rules = Array.from({ length: 30 }, (_, i) => ({
    id: `RULE-${i}`, enabled: true, severity: i === 29 ? "FATAL" : "WARN", scope: i % 2 ? "security" : "ui",
    intent: `Intent ${i}`, fix: "Move responsibilities to the right layer. ".repeat(20),
    prompt: { requirement: `Required behavior ${i}`, violation: "Violation wording ".repeat(20), solution: "Solution wording ".repeat(20) },
    context: ["src"], detect: { regex: "fetch" },
  }));
  const evidence = rules.slice(0, 29).map((rule) => ({
    ruleId: rule.id, mode: "local-regex", totalMatches: 10,
    matches: Array.from({ length: 10 }, (_, i) => ({ file: "src/main.js", line: i + 1, matchId: `${rule.id}:${i}`, snippet: "x".repeat(2000) })),
  }));
  return { rules, evidence, config: { stack: "frontend-base", enabledRuleIds: rules.map((rule) => rule.id) }, localeMap: {}, reportSchemaText: '{"violations":[]}' };
}

test("budgeted audit reduces size while retaining semantic rules and full cached inputs", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const full = buildAuditPrompt({ ...input, contextOptions: { mode: "full" } });
  const balanced = buildAuditPrompt(input);
  const compact = buildAuditPrompt({ ...input, contextOptions: { mode: "compact" } });
  assert.ok(balanced.length < full.length / 3);
  assert.ok(compact.length < balanced.length);
  for (const rule of input.rules) {
    assert.ok(compact.includes(rule.prompt.requirement));
    assert.ok(balanced.includes(rule.prompt.requirement));
  }
  assert.match(balanced, /Omitted evidence rules=17, matches=254/);
  assert.match(balanced, /not proof of safety/);
  assert.equal(JSON.stringify(input), before);
  assert.ok(full.includes("x".repeat(2000)));
  assert.ok(!balanced.includes("x".repeat(241)));
});

test("evidence budgets prioritize severity and keep identity and total counts", () => {
  const input = fixture();
  input.rules[28].severity = "FATAL";
  const { evidence } = budgetEvidence(input.evidence, input.rules, resolveContextOptions({ maxEvidenceRules: 1, maxMatchesPerRule: 1, maxSnippetChars: 8 }));
  assert.equal(evidence[0].ruleId, "RULE-28");
  assert.equal(evidence[0].totalMatches, 10);
  assert.equal(evidence[0].matches[0].matchId, "RULE-28:0");
  assert.equal(evidence[0].matches[0].snippet, "xxxxxxxx [truncated]");
  assert.equal(budgetEvidence(input.evidence, input.rules, resolveContextOptions({ maxEvidenceRules: 0 })).evidence.length, 0);
});

test("focused audit excludes other rules and rejects empty or invalid selectors", () => {
  const input = fixture();
  const prompt = buildAuditPrompt({ ...input, contextOptions: { rule: "RULE-29", scope: "security", mode: "full" } });
  assert.match(prompt, /### RULE-29/);
  assert.doesNotMatch(prompt, /### RULE-0\b/);
  assert.throws(() => buildAuditPrompt({ ...input, contextOptions: { rule: "missing" } }), /No enabled rules/);
  for (const argv of [["--context-mode", "bad"], ["--rule"], ["--max-snippet-chars", "-1"], ["--max-matches-per-rule", "2.5"], ["--max-evidence-rules", "Infinity"]]) {
    assert.throws(() => parseContextOptions(argv));
  }
});

test("all logic profiles budget candidates and preserve report filenames and semantic requirements", () => {
  const input = fixture();
  const validator = {
    summary: { localEvidenceRules: 30, aiReviewRules: 0, validatorViolationCount: 300 },
    results: input.rules.map((rule) => ({ ruleId: rule.id, evidenceCount: 10 })),
    violations: input.rules.flatMap((rule) => Array.from({ length: 10 }, (_, i) => ({ ruleId: rule.id, issueId: `${rule.id}:${i}`, files: ["src/main.js"], description: "y".repeat(2000) }))),
  };
  for (const profile of ["logic", "native", "model"]) {
    const args = { ...input, ruleIR: input.rules, validator, profile, logicContext: { riskKeywords: ["ownership"], highRiskFiles: ["src/main.js"] } };
    const prompt = buildLogicPrompt(args);
    const full = buildLogicPrompt({ ...args, contextOptions: { mode: "full" } });
    assert.ok(prompt.length < full.length / 3);
    assert.match(prompt, /Omitted validator results=18, candidate violations=264/);
    assert.ok(prompt.includes(`ai-${profile}-report.json`));
    assert.ok(prompt.includes("Required behavior 29"));
    assert.ok(!prompt.includes("y".repeat(241)));
    const focused = buildLogicPrompt({ ...args, contextOptions: { rule: "RULE-29", mode: "full" } });
    assert.doesNotMatch(focused, /- RULE-0\b/);
    assert.ok(focused.includes("y".repeat(2000)));
  }
});
