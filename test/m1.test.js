const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { loadConfig } = require("../cli/src/core/config/load-config");
const { validatePathAliases, pathAliasProbePath } = require("../cli/src/core/config/validate-config");
const { parseRules } = require("../cli/src/core/rules/parse-rules");
const { resolveRulePaths } = require("../cli/src/core/rules/resolve-rules");
const { validateRules } = require("../cli/src/core/rules/validate-rules");
const { collectEvidence } = require("../cli/src/core/evidence/collect");
const { buildAuditPrompt } = require("../cli/src/core/prompt/build-audit-prompt");
const { normalizeReport } = require("../cli/src/core/report/normalize");
const { readLocaleMap } = require("../cli/src/utils/templates");

const execFileAsync = promisify(execFile);

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
      thresholds: { maxFunctionLines: 80 },
      exceptions: { "ARCH-*": ["stories/**"] },
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
      thresholds: { maxParamsCount: 5 },
      exceptions: { "ARCH-*": ["mock/**"], "SEC-*": ["fixtures/**"] },
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
  assert.deepEqual(config.thresholds, {
    maxFunctionLines: 80,
    maxParamsCount: 5,
  });
  assert.deepEqual(config.exceptions, {
    "ARCH-*": ["stories/**", "mock/**"],
    "SEC-*": ["fixtures/**"],
  });
  assert.deepEqual(config.prompt.promptTemplateKeys, {
    auditSystem: "base.audit",
    repairSystem: "child.repair",
  });
});

test("loadConfig merges optional sidecar config.json", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-sidecar-config-"));
  const configPath = path.join(tempDir, "rules-config.json");
  const sidecarPath = path.join(tempDir, "config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      stack: "spring",
      enabledRuleIds: ["RULE-001"],
      scopes: ["architecture"],
      pathAliases: {
        "@service": "src/main/java/**/service",
      },
    }),
    "utf8"
  );

  await fs.writeFile(
    sidecarPath,
    JSON.stringify({
      pathAliases: {
        "@service": "app/services",
        "@controller": "app/controllers",
      },
      thresholds: {
        maxFunctionLines: 80,
      },
    }),
    "utf8"
  );

  const config = await loadConfig(configPath);

  assert.deepEqual(config.pathAliases, {
    "@service": "app/services",
    "@controller": "app/controllers",
  });
  assert.deepEqual(config.thresholds, {
    maxFunctionLines: 80,
  });
});

test("validatePathAliases warns when configured paths do not exist", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-alias-warning-"));
  await fs.mkdir(path.join(tempDir, ".ai-rules"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });

  assert.equal(pathAliasProbePath("src/main/java/**/controller"), "src/main/java");
  assert.equal(pathAliasProbePath("src/(components|pages|views)"), "src");

  const findings = await validatePathAliases({
    cwd: tempDir,
    configDir: path.join(tempDir, ".ai-rules"),
    pathAliases: {
      "@ok": "src/(components|pages|views)",
      "@missing": "app/controllers",
    },
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /IMPORTANT: pathAliases\.@missing/);
  assert.match(findings[0].message, /\.ai-rules\/config\.json/);
});


test("resolveRulePaths expands path aliases in context and detect.where", () => {
  const rules = resolveRulePaths(
    [
      {
        id: "RULE-001",
        context: ["@service", "@controller/**"],
        detect: {
          import: "@service/**",
          include: "@controller/**",
          where: "filePath in @controller/**",
        },
      },
    ],
    {
      pathAliases: {
        "@service": "app/services",
        "@controller": "app/controllers",
      },
    }
  );

  assert.deepEqual(rules[0].context, ["app/services", "app/controllers/**"]);
  assert.equal(rules[0].detect.where, "filePath in app/controllers/**");
  assert.equal(rules[0].detect.import, "app/services/**");
  assert.equal(rules[0].detect.include, "app/controllers/**");
});

test("readLocaleMap supports additional locales with English fallback", async () => {
  for (const locale of ["zh-TW", "ja", "ko", "es", "fr"]) {
    const localeMap = await readLocaleMap(locale);
    assert.ok(localeMap["template.frontend-base.title"]);
    assert.ok(localeMap["rule.ARCH-101.intent"]);
    assert.notEqual(localeMap["template.frontend-base.title"], "AI-RULES Frontend Base Template");
  }
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

test("collectEvidence gathers minimal count metrics", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-count-"));
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "module.py"),
    [
      "def oversized(alpha, beta, gamma, delta, epsilon, zeta):",
      "    first = alpha + beta",
      "    second = gamma + delta",
      "    third = epsilon + zeta",
      "    fourth = first + second",
      "    return third + fourth",
      "",
    ].join("\n"),
    "utf8"
  );

  const evidence = await collectEvidence({
    cwd: tempDir,
    config: {
      detectOptions: {
        include: ["src/**/*.py"],
        exclude: [],
      },
      thresholds: {
        maxFunctionLines: 4,
        maxParamsCount: 5,
      },
    },
    rules: [
      {
        id: "COUNT-001",
        detect: { count: "function-lines", thresholdKey: "maxFunctionLines" },
      },
      {
        id: "COUNT-002",
        detect: { count: "params-count", thresholdKey: "maxParamsCount" },
      },
    ],
  });

  assert.equal(evidence[0].mode, "local-count");
  assert.equal(evidence[0].totalMatches, 1);
  assert.match(evidence[0].matches[0].snippet, /function-lines=7/);
  assert.equal(evidence[1].mode, "local-count");
  assert.equal(evidence[1].totalMatches, 1);
  assert.match(evidence[1].matches[0].snippet, /params-count=6/);
});

test("collectEvidence respects rule exceptions from config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-exceptions-"));
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "stories"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "src", "page.ts"), "const data = fetch('/api');\n", "utf8");
  await fs.writeFile(path.join(tempDir, "stories", "demo.ts"), "const data = fetch('/mock');\n", "utf8");

  const evidence = await collectEvidence({
    cwd: tempDir,
    config: {
      detectOptions: {
        include: ["**/*.ts"],
        exclude: [],
      },
      exceptions: {
        "ARCH-*": ["stories/**"],
      },
    },
    rules: [
      {
        id: "ARCH-101",
        detect: { regex: "fetch\\(" },
      },
    ],
  });

  assert.equal(evidence[0].totalMatches, 1);
  assert.deepEqual(evidence[0].exceptionPatterns, ["stories/**"]);
  assert.equal(evidence[0].suppressedFileCount, 1);
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
      thresholds: {
        maxFunctionLines: 80,
        maxParamsCount: 5,
      },
      exceptions: {
        "RULE-*": ["stories/**"],
      },
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
        exceptionPatterns: ["stories/**"],
        suppressedFileCount: 2,
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
  assert.match(prompt, /maxFunctionLines=80/);
  assert.match(prompt, /RULE-\*:1/);
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

test("doctor reports invalid thresholds and exceptions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-doctor-"));
  const aiRulesDir = path.join(tempDir, ".ai-rules");
  await fs.mkdir(aiRulesDir, { recursive: true });
  await fs.writeFile(
    path.join(aiRulesDir, "rules-config.json"),
    JSON.stringify({
      rulesFile: ".ai-rules.md",
      enabledRuleIds: ["RULE-001"],
      scopes: ["security"],
      thresholds: {
        maxFunctionLines: "80",
      },
      exceptions: {
        "RULE-*": "fixtures/**",
      },
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(aiRulesDir, ".ai-rules.md"),
    [
      "### RULE: RULE-001",
      "severity: WARN",
      "scope: security",
      "intent: Keep things safe",
      "",
      "detect:",
      "  regex: \"secret\"",
      "fix: Remove the secret",
      "prompt:",
      "  violation: Secret found",
      "  requirement: Secrets must not be committed",
      "  solution: Move secrets to secure config",
      "",
    ].join("\n"),
    "utf8"
  );

  const cliPath = path.join(__dirname, "..", "cli", "src", "index.js");
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "doctor"], { cwd: tempDir }),
    (err) => {
      const output = `${err.stdout || ""}${err.stderr || ""}`;
      assert.match(output, /thresholds\.maxFunctionLines must be a finite number/);
      assert.match(output, /exceptions\.RULE-\* must be an array of glob strings/);
      return true;
    }
  );
});

test("doctor warns when pathAliases point to missing paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-doctor-alias-"));
  const aiRulesDir = path.join(tempDir, ".ai-rules");
  await fs.mkdir(aiRulesDir, { recursive: true });
  await fs.writeFile(
    path.join(aiRulesDir, "rules-config.json"),
    JSON.stringify({
      rulesFile: ".ai-rules.md",
      enabledRuleIds: ["RULE-001"],
      scopes: ["security"],
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(aiRulesDir, "config.json"),
    JSON.stringify({
      pathAliases: {
        "@missing": "app/controllers",
      },
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(aiRulesDir, ".ai-rules.md"),
    [
      "### RULE: RULE-001",
      "severity: WARN",
      "scope: security",
      "intent: Keep things safe",
      "",
      "detect:",
      "  regex: \"secret\"",
      "fix: Remove the secret",
      "prompt:",
      "  violation: Secret found",
      "  requirement: Secrets must not be committed",
      "  solution: Move secrets to secure config",
      "",
    ].join("\n"),
    "utf8"
  );

  const cliPath = path.join(__dirname, "..", "cli", "src", "index.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "doctor"], { cwd: tempDir });

  assert.match(stdout, /IMPORTANT: pathAliases\.@missing/);
  assert.match(stdout, /\.ai-rules\/config\.json/);
});

test("audit supports summary and dry-run output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-audit-modes-"));
  const aiRulesDir = path.join(tempDir, ".ai-rules");
  await fs.mkdir(aiRulesDir, { recursive: true });
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "module.py"),
    [
      "def oversized(alpha, beta, gamma, delta, epsilon, zeta):",
      "    first = alpha + beta",
      "    second = gamma + delta",
      "    third = epsilon + zeta",
      "    fourth = first + second",
      "    return third + fourth",
      "",
      "def uses_secret(secret):",
      "    return secret",
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(aiRulesDir, "rules-config.json"),
    JSON.stringify({
      rulesFile: ".ai-rules.md",
      stack: "python-base",
      enabledRuleIds: ["COUNT-001", "REGEX-001", "AI-001"],
      scopes: ["code-safety", "security"],
      thresholds: {
        maxFunctionLines: 4,
      },
      exceptions: {
        "REGEX-*": ["fixtures/**"],
      },
      detectOptions: {
        include: ["src/**/*.py"],
        exclude: ["dist/**"],
      },
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(aiRulesDir, ".ai-rules.md"),
    [
      "### RULE: COUNT-001",
      "severity: WARN",
      "scope: code-safety",
      "intent: Keep functions small",
      "detect:",
      "  count: function-lines",
      "  thresholdKey: maxFunctionLines",
      "  where: filePath in src/**/*.py",
      "fix: Split the function",
      "prompt:",
      "  violation: Function too large",
      "  requirement: Functions must remain small",
      "  solution: Extract helpers",
      "",
      "### RULE: REGEX-001",
      "severity: WARN",
      "scope: security",
      "intent: Avoid direct secret flow",
      "detect:",
      "  regex: \"secret\"",
      "  where: filePath in src/**/*.py",
      "fix: Remove direct secret usage",
      "prompt:",
      "  violation: Secret pattern found",
      "  requirement: Secrets must not flow directly",
      "  solution: Refactor sensitive handling",
      "",
      "### RULE: AI-001",
      "severity: WARN",
      "scope: security",
      "intent: Needs semantic review",
      "detect:",
      "  semantic: complicated pattern",
      "fix: Review carefully",
      "prompt:",
      "  violation: Semantic concern",
      "  requirement: Keep the boundary safe",
      "  solution: Use a safer pattern",
      "",
    ].join("\n"),
    "utf8"
  );

  const cliPath = path.join(__dirname, "..", "cli", "src", "index.js");
  const summary = await execFileAsync(process.execPath, [cliPath, "audit", "--summary"], { cwd: tempDir });
  const dryRun = await execFileAsync(process.execPath, [cliPath, "audit", "--dry-run"], { cwd: tempDir });

  assert.match(summary.stdout, /AI-RULES AUDIT SUMMARY/);
  assert.match(summary.stdout, /enabled rule count: 3/);
  assert.match(summary.stdout, /local-evidence rule count: 2/);
  assert.match(summary.stdout, /ai-only rule count: 1/);
  assert.match(summary.stdout, /maxFunctionLines=4/);

  assert.match(dryRun.stdout, /AI-RULES AUDIT DRY RUN/);
  assert.match(dryRun.stdout, /include patterns: src\/\*\*\/\*\.py/);
  assert.match(dryRun.stdout, /local rules: COUNT-001, REGEX-001/);
  assert.match(dryRun.stdout, /ai-only rules: AI-001/);
  assert.match(dryRun.stdout, /REGEX-\*: fixtures\/\*\*/);
});


test("current expanded templates parse and validate", async () => {
  const templateConfigs = [
    path.join(__dirname, "..", "templates", "frontend-base", "rules-config.json"),
    path.join(__dirname, "..", "templates", "frontend-base", "react-js", "rules-config.json"),
    path.join(__dirname, "..", "templates", "frontend-base", "react-ts", "rules-config.json"),
    path.join(__dirname, "..", "templates", "frontend-base", "vue", "rules-config.json"),
    path.join(__dirname, "..", "templates", "python-base", "rules-config.json"),
    path.join(__dirname, "..", "templates", "python-base", "python-fastapi", "rules-config.json"),
    path.join(__dirname, "..", "templates", "java-base", "rules-config.json"),
    path.join(__dirname, "..", "templates", "java-base", "java-spring", "rules-config.json"),
    path.join(__dirname, "..", "templates", "c-cpp", "rules-config.json"),
  ];

  for (const configPath of templateConfigs) {
    const config = await loadConfig(configPath);
    const rulesPath = path.resolve(path.dirname(configPath), config.rulesFile || ".ai-rules.md");
    const rules = await parseRules(rulesPath);
    const ruleIds = new Set(rules.map((rule) => rule.id));
    const missingRuleIds = config.enabledRuleIds.filter((ruleId) => !ruleIds.has(ruleId));

    assert.deepEqual(
      missingRuleIds,
      [],
      `${path.relative(path.join(__dirname, ".."), configPath)} should only enable rules present in the parsed templates`
    );
  }
});
