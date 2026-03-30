const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { loadConfig } = require("../cli/src/core/config/load-config");
const { parseRules } = require("../cli/src/core/rules/parse-rules");
const { validateRules } = require("../cli/src/core/rules/validate-rules");
const { collectEvidence } = require("../cli/src/core/evidence/collect");
const { buildAuditPrompt } = require("../cli/src/core/prompt/build-audit-prompt");
const { normalizeReport } = require("../cli/src/core/report/normalize");

test("loadConfig merges extends chains", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-config-"));
  const basePath = path.join(tempDir, "base.json");
  const childPath = path.join(tempDir, "child.json");

  await fs.writeFile(
    basePath,
    JSON.stringify({
      stack: "base",
      enabledRuleIds: ["BASE-001"],
      scopes: ["base"],
      pathAliases: { "@base": "src/base" },
      detectOptions: { include: ["src/**/*.js"], exclude: ["dist/**"] },
      prompt: { style: "strict", promptTemplateKeys: { auditSystem: "base.audit" } },
    }),
    "utf8"
  );

  await fs.writeFile(
    childPath,
    JSON.stringify({
      extends: "./base.json",
      stack: "child",
      enabledRuleIds: ["CHILD-001"],
      scopes: ["child"],
      pathAliases: { "@child": "src/child" },
      detectOptions: { include: ["tests/**/*.js"], exclude: ["coverage/**"] },
      prompt: { includeContextAssets: true, promptTemplateKeys: { repairSystem: "child.repair" } },
    }),
    "utf8"
  );

  const config = await loadConfig(childPath);

  assert.equal(config.stack, "child");
  assert.deepEqual(config.enabledRuleIds, ["BASE-001", "CHILD-001"]);
  assert.deepEqual(config.scopes, ["base", "child"]);
  assert.deepEqual(config.pathAliases, {
    "@base": "src/base",
    "@child": "src/child",
  });
  assert.deepEqual(config.detectOptions.include, ["src/**/*.js", "tests/**/*.js"]);
  assert.deepEqual(config.detectOptions.exclude, ["dist/**", "coverage/**"]);
  assert.deepEqual(config.prompt.promptTemplateKeys, {
    auditSystem: "base.audit",
    repairSystem: "child.repair",
  });
});

test("parseRules resolves extends and preserves rule fields", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-rules-"));
  const basePath = path.join(tempDir, "base.md");
  const childPath = path.join(tempDir, "child.md");

  await fs.writeFile(
    basePath,
    [
      "### RULE: BASE-001",
      "severity: WARN",
      "scope: architecture",
      "intent: Base intent",
      "",
      "detect:",
      "  regex: \"fetch\"",
      "fix: Base fix",
      "prompt:",
      "  violation: Base violation",
      "  requirement: Base requirement",
      "  solution: Base solution",
      "context:",
      "  - src/base",
      "",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    childPath,
    [
      "extends: ./base.md",
      "",
      "### RULE: CHILD-001",
      "severity: FATAL",
      "scope: security",
      "intent: Child intent",
      "detect:",
      "  semantic: dangerous flow",
      "  where: filePath in src/**",
      "fix: Child fix",
      "prompt:",
      "  violation: Child violation",
      "  requirement: Child requirement",
      "  solution: Child solution",
      "context:",
      "  - src/child",
      "",
    ].join("\n"),
    "utf8"
  );

  const rules = await parseRules(childPath);

  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, "BASE-001");
  assert.equal(rules[0].detectKind, "regex");
  assert.deepEqual(rules[0].context, ["src/base"]);
  assert.equal(rules[1].id, "CHILD-001");
  assert.equal(rules[1].detect.semantic, "dangerous flow");
  assert.equal(rules[1].detect.where, "filePath in src/**");
});

test("validateRules reports missing enabled rules and unknown scopes", () => {
  const findings = validateRules({
    config: {
      enabledRuleIds: ["RULE-001", "RULE-404"],
      scopes: ["architecture"],
    },
    rules: [
      {
        id: "RULE-001",
        severity: "WARN",
        scope: "unknown",
        intent: "Intent",
        fix: "Fix",
        detect: { regex: "x" },
        prompt: {
          violation: "v",
          requirement: "r",
          solution: "s",
        },
        context: [],
      },
    ],
  });

  assert.deepEqual(
    findings.map((item) => item.message),
    [
      "Rule 'RULE-001' uses scope 'unknown' that is not declared in rules-config.json.",
      "enabledRuleIds references missing rule 'RULE-404'.",
    ]
  );
});

test("collectEvidence gathers regex and import candidates", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-evidence-"));
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "page.ts"),
    [
      "import api from \"platform/http\";",
      "const data = fetch('/api');",
      "",
    ].join("\n"),
    "utf8"
  );

  const evidence = await collectEvidence({
    cwd: tempDir,
    config: {
      detectOptions: {
        include: ["src/**/*.ts"],
        exclude: [],
      },
    },
    rules: [
      {
        id: "REGEX-001",
        detect: { regex: "fetch\\(" },
      },
      {
        id: "IMPORT-001",
        detect: { import: "platform/**", where: "importer in src/**" },
      },
      {
        id: "AI-001",
        detect: { semantic: "complicated" },
      },
    ],
  });

  assert.equal(evidence[0].mode, "local-regex");
  assert.equal(evidence[0].totalMatches, 1);
  assert.equal(evidence[1].mode, "local-import");
  assert.equal(evidence[1].matches[0].reference, "platform/http");
  assert.equal(evidence[2].mode, "ai-only");
});

test("buildAuditPrompt includes config, rules, and evidence sections", () => {
  const prompt = buildAuditPrompt({
    localeMap: {},
    config: {
      stack: "react-ts",
      severityThreshold: "WARN",
      scopes: ["ui", "react"],
      detectOptions: {
        include: ["src/**/*.ts"],
        exclude: ["dist/**"],
      },
      enabledRuleIds: ["RULE-001"],
      prompt: {
        promptTemplates: {
          auditSystem: "System prompt",
          auditUser: "User prompt",
        },
      },
    },
    rules: [
      {
        id: "RULE-001",
        severity: "WARN",
        scope: "ui",
        intent: "Do not fetch in components",
        fix: "Move to service",
        detect: { regex: "fetch\\(", where: "filePath in src/**" },
        prompt: {
          violation: "Found fetch",
          requirement: "No fetch in ui",
          solution: "Use service layer",
        },
        context: ["src/services"],
      },
    ],
    evidence: [
      {
        ruleId: "RULE-001",
        mode: "local-regex",
        totalMatches: 1,
        matches: [
          {
            file: "src/page.ts",
            line: 2,
            snippet: "const data = fetch('/api');",
          },
        ],
      },
    ],
    reportSchemaText: '{ "violations": [] }',
  });

  assert.match(prompt, /Project config summary:/);
  assert.match(prompt, /### RULE-001/);
  assert.match(prompt, /src\/page\.ts:2/);
  assert.match(prompt, /Return strict JSON only/);
});

test("normalizeReport standardizes legacy report shapes", () => {
  const normalized = normalizeReport({
    version: "1.0",
    issues: [
      {
        issue_id: "ISSUE-001",
        rule_id: "RULE-001",
        severity: "warning",
        path: "src/app.ts",
        row: 8,
        message: "Bad pattern",
        suggestion: "Fix it",
        prompt: { repair: "Patch here" },
        evidence: { matchedBy: "detect.regex" },
      },
    ],
  });

  assert.equal(normalized.report.summary.total, 1);
  assert.equal(normalized.report.violations[0].issueId, "ISSUE-001");
  assert.equal(normalized.report.violations[0].ruleId, "RULE-001");
  assert.equal(normalized.report.violations[0].severity, "WARN");
  assert.equal(normalized.report.violations[0].file, "src/app.ts");
  assert.equal(normalized.report.violations[0].line, 8);
  assert.equal(normalized.report.violations[0].repairPrompt, "Patch here");
  assert.equal(normalized.report.violations[0].evidence.source, "local-regex");
  assert.equal(normalized.findings.length, 0);
});

test("normalizeReport reports structural errors", () => {
  const normalized = normalizeReport({
    violations: [
      {
        severity: "oops",
      },
      {
        issueId: "ISSUE-001",
        ruleId: "RULE-001",
        severity: "INFO",
      },
      {
        issueId: "ISSUE-001",
        ruleId: "RULE-002",
        severity: "INFO",
      },
    ],
  });

  assert.ok(normalized.findings.some((item) => item.message.includes("missing issueId")));
  assert.ok(normalized.findings.some((item) => item.message.includes("Duplicate issueId 'ISSUE-001'")));
  assert.ok(normalized.findings.some((item) => item.message.includes("invalid severity 'OOPS'")));
});
