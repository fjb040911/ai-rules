const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const { loadConfig } = require("../cli/src/core/config/load-config");
const {
  validatePathAliases,
  pathAliasProbePath,
  validateAstConfig,
} = require("../cli/src/core/config/validate-config");
const { resolveAstConfig } = require("../cli/src/core/config/resolve-ast-config");
const { parseRules } = require("../cli/src/core/rules/parse-rules");
const { resolveRulePaths } = require("../cli/src/core/rules/resolve-rules");
const { compileRulesToIR } = require("../cli/src/core/rules/compile-rule-ir");
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
      ast: {
        provider: "babel",
        parserOptions: {
          plugins: ["jsx", "typescript"],
        },
      },
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
  assert.deepEqual(config.ast, {
    provider: "babel",
    parserOptions: {
      plugins: ["jsx", "typescript"],
    },
  });
});

test("validateAstConfig rejects invalid ast config shapes", () => {
  const findings = validateAstConfig({
    provider: ["babel"],
    useProjectConfig: "yes",
    parserOptions: {
      plugins: "jsx",
    },
  });

  assert.ok(findings.some((item) => item.message.includes("ast.provider")));
  assert.ok(findings.some((item) => item.message.includes("ast.useProjectConfig")));
  assert.ok(findings.some((item) => item.message.includes("ast.parserOptions.plugins")));
});

test("resolveAstConfig merges defaults, detected project config, and local overrides", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-ast-config-"));
  await fs.writeFile(
    path.join(tempDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        allowJs: true,
        experimentalDecorators: true,
      },
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({
      dependencies: {
        react: "^18.0.0",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
      babel: {
        presets: ["@babel/preset-react", "@babel/preset-typescript"],
      },
    }),
    "utf8"
  );

  const resolved = await resolveAstConfig({
    cwd: tempDir,
    config: {
      stack: "react-js",
      ast: {
        parserOptions: {
          sourceType: "script",
        },
      },
    },
  });

  assert.equal(resolved.provider, "babel");
  assert.equal(resolved.target, "react");
  assert.equal(resolved.parserOptions.sourceType, "script");
  assert.ok(resolved.parserOptions.plugins.includes("jsx"));
  assert.ok(resolved.parserOptions.plugins.includes("typescript"));
  assert.ok(resolved.parserOptions.plugins.includes("decorators-legacy"));
  assert.ok(resolved.sources.includes("defaults"));
  assert.ok(resolved.sources.includes("tsconfig.json"));
  assert.ok(resolved.sources.includes("package.json#babel"));
  assert.ok(resolved.sources.includes("ai-rules-config"));
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

test("compileRulesToIR builds executable rule metadata", () => {
  const ruleIR = compileRulesToIR({
    config: {
      stack: "react-ts",
      enabledRuleIds: ["RULE-001"],
    },
    rules: [
      {
        id: "RULE-001",
        severity: "WARN",
        scope: "ui",
        intent: "Do not fetch in UI",
        fix: "Move network logic to service layer",
        detectKind: "regex",
        detect: { regex: "fetch\\(", where: "filePath in src/**" },
        prompt: {
          violation: "Found fetch",
          requirement: "UI must not fetch directly",
          solution: "Use a service",
        },
        context: ["src/services"],
      },
    ],
  });

  assert.equal(ruleIR.length, 1);
  assert.equal(ruleIR[0].id, "RULE-001");
  assert.equal(ruleIR[0].enabled, true);
  assert.equal(ruleIR[0].metadata.stack, "react-ts");
  assert.equal(ruleIR[0].execution.phase, "post-generation-validation");
  assert.equal(ruleIR[0].validator.mode, "local");
  assert.equal(ruleIR[0].repair.requirement, "UI must not fetch directly");
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
  assert.equal(evidence[0].evidenceId, "evidence:REGEX-001");
  assert.equal(evidence[0].matches[0].matchId, "evidence:REGEX-001:match:1");
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

test("collectEvidence gathers frontend AST candidates", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-ast-evidence-"));
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "widget.tsx"),
    [
      "type Item = any;",
      "export function Widget({ items }) {",
      "  const load = () => fetch('/api/items');",
      "  const html = '<b>x</b>';",
      "  return (",
      "    <div>",
      "      <section dangerouslySetInnerHTML={{ __html: html }} />",
      "      {items.map((item, index) => <span key={index}>{item.name}</span>)}",
      "    </div>",
      "  );",
      "}",
      "eval('console.log(1)');",
      "",
    ].join("\n"),
    "utf8"
  );

  const evidence = await collectEvidence({
    cwd: tempDir,
    config: {
      detectOptions: {
        include: ["src/**/*.{ts,tsx}"],
        exclude: [],
      },
      resolvedAstConfig: {
        provider: "babel",
        target: "react",
        parserOptions: {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        },
      },
    },
    rules: [
      {
        id: "ARCH-101",
        detect: { ast: "frontend/no-direct-network-call", where: "filePath in src/**/*.tsx" },
      },
      {
        id: "FE-SEC-101",
        detect: { ast: "frontend/no-raw-html-injection", where: "filePath in src/**/*.tsx" },
      },
      {
        id: "FE-SEC-102",
        detect: { ast: "frontend/no-dynamic-code-exec", where: "filePath in src/**/*.tsx" },
      },
      {
        id: "REACT-303",
        detect: { ast: "react/no-index-key", where: "filePath in src/**/*.tsx" },
      },
      {
        id: "TS-401",
        detect: { ast: "typescript/no-any", where: "filePath in src/**/*.tsx" },
      },
      {
        id: "AST-UNSUPPORTED",
        detect: { ast: "CallExpression[callee.name=/fetch/]" },
      },
    ],
  });

  assert.equal(evidence[0].mode, "local-ast");
  assert.equal(evidence[0].totalMatches, 1);
  assert.equal(evidence[0].strategy, "frontend/no-direct-network-call");
  assert.equal(evidence[0].confidence, 0.93);
  assert.match(evidence[0].matches[0].snippet, /fetch/);

  assert.equal(evidence[1].mode, "local-ast");
  assert.equal(evidence[1].totalMatches, 1);
  assert.match(evidence[1].matches[0].snippet, /dangerouslySetInnerHTML/);

  assert.equal(evidence[2].mode, "local-ast");
  assert.equal(evidence[2].totalMatches, 1);
  assert.match(evidence[2].matches[0].snippet, /eval/);

  assert.equal(evidence[3].mode, "local-ast");
  assert.equal(evidence[3].totalMatches, 1);
  assert.match(evidence[3].matches[0].snippet, /key=\{index\}/);

  assert.equal(evidence[4].mode, "local-ast");
  assert.equal(evidence[4].totalMatches, 1);
  assert.match(evidence[4].matches[0].snippet, /type Item = any/);

  assert.equal(evidence[5].mode, "ai-only");
  assert.match(evidence[5].note, /not supported/);
});

test("collectEvidence keeps non-frontend ast rules AI-only without crashing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-ast-non-frontend-"));
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "service.py"),
    [
      "def typed(value):",
      "    return value",
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(tempDir, "src", "Service.java"),
    [
      "class Service {",
      "  Object value;",
      "}",
      "",
    ].join("\n"),
    "utf8"
  );

  const evidence = await collectEvidence({
    cwd: tempDir,
    config: {
      detectOptions: {
        include: ["src/**/*.{py,java}"],
        exclude: [],
      },
    },
    rules: [
      {
        id: "PY-AST-001",
        detect: { ast: "typescript/no-any", where: "filePath in src/**/*.py" },
      },
      {
        id: "JAVA-AST-001",
        detect: { ast: "frontend/no-dynamic-code-exec", where: "filePath in src/**/*.java" },
      },
    ],
  });

  assert.equal(evidence[0].mode, "ai-only");
  assert.match(evidence[0].note, /No local AST backend is configured|frontend JS\/TS\/Vue files/);
  assert.equal(evidence[1].mode, "ai-only");
  assert.match(evidence[1].note, /No local AST backend is configured|frontend JS\/TS\/Vue files/);
});

test("collectEvidence gathers Vue AST candidates", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-vue-ast-evidence-"));
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "Widget.vue"),
    [
      "<template>",
      "  <li v-for=\"(item, index) in items\" :key=\"index\">{{ item.name }}</li>",
      "</template>",
      "<script setup lang=\"ts\">",
      "const props = defineProps<{ count: number }>();",
      "props.count = props.count + 1;",
      "</script>",
      "",
    ].join("\n"),
    "utf8"
  );

  const evidence = await collectEvidence({
    cwd: tempDir,
    config: {
      detectOptions: {
        include: ["src/**/*.vue"],
        exclude: [],
      },
      resolvedAstConfig: {
        provider: "vue-sfc",
        target: "vue",
        scriptParser: "babel",
        parserOptions: {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        },
      },
    },
    rules: [
      {
        id: "VUE-304",
        detect: { ast: "vue/no-prop-mutation", where: "filePath in src/**/*.vue" },
      },
      {
        id: "VUE-305",
        detect: { ast: "vue/no-index-key", where: "filePath in src/**/*.vue" },
      },
    ],
  });

  assert.equal(evidence[0].mode, "local-ast");
  assert.equal(evidence[0].totalMatches, 1);
  assert.equal(evidence[0].strategy, "vue/no-prop-mutation");
  assert.match(evidence[0].matches[0].snippet, /props\.count/);

  assert.equal(evidence[1].mode, "local-ast");
  assert.equal(evidence[1].totalMatches, 1);
  assert.equal(evidence[1].strategy, "vue/no-index-key");
  assert.match(evidence[1].matches[0].snippet, /:key="index"/);
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
        evidenceId: "evidence:RULE-001",
        ruleId: "RULE-001",
        mode: "local-regex",
        strategy: "detect.regex",
        confidence: 0.82,
        totalMatches: 1,
        exceptionPatterns: ["stories/**"],
        suppressedFileCount: 2,
        matches: [
          {
            matchId: "evidence:RULE-001:match:1",
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
  assert.match(prompt, /evidenceId=evidence:RULE-001/);
  assert.match(prompt, /evidence:RULE-001:match:1/);
  assert.match(prompt, /src\/page\.ts:2/);
  assert.match(prompt, /strategy: detect\.regex/);
  assert.match(prompt, /confidence: 0\.82/);
  assert.match(prompt, /maxFunctionLines=80/);
  assert.match(prompt, /RULE-\*:1/);
  assert.match(prompt, /Return strict JSON only/);
  assert.match(prompt, /Save the final JSON result as ai-rule-report\.json/);
  assert.match(prompt, /AST-backed local evidence/);
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
  assert.equal(normalized.report.violations[0].evidence.evidenceId, null);
  assert.equal(normalized.findings.length, 0);
});

test("normalizeReport maps detect.ast and detect.count to local evidence sources", () => {
  const normalized = normalizeReport({
    violations: [
      {
        issueId: "ISSUE-COUNT",
        ruleId: "RULE-COUNT",
        severity: "WARN",
        detect: "detect.count",
      },
      {
        issueId: "ISSUE-AST",
        ruleId: "RULE-AST",
        severity: "WARN",
        detect: "detect.ast",
        evidence: {
          strategy: "frontend/no-direct-network-call",
          confidence: 0.93,
        },
      },
    ],
  });

  assert.equal(normalized.report.violations[0].evidence.source, "local-count");
  assert.equal(normalized.report.violations[1].evidence.source, "local-ast");
  assert.equal(normalized.report.violations[1].evidence.strategy, "frontend/no-direct-network-call");
  assert.equal(normalized.report.violations[1].evidence.confidence, 0.93);
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
});

test("normalizeReport preserves evidence references and warns on unknown evidence ids", () => {
  const normalized = normalizeReport(
    {
      violations: [
        {
          issueId: "ISSUE-001",
          ruleId: "RULE-001",
          severity: "CRITICAL",
          evidence: {
            evidenceId: "evidence:RULE-001",
            evidenceIds: ["evidence:RULE-001", "evidence:RULE-001:match:2", "evidence:missing"],
          },
        },
      ],
    },
    {
      availableEvidenceIds: new Set(["evidence:RULE-001", "evidence:RULE-001:match:2"]),
    }
  );

  assert.equal(normalized.report.violations[0].severity, "INFO");
  assert.deepEqual(normalized.report.violations[0].evidence.evidenceIds, [
    "evidence:RULE-001",
    "evidence:RULE-001:match:2",
    "evidence:missing",
  ]);
  assert.ok(
    normalized.findings.some((item) => item.message.includes("references unknown evidenceId(s): evidence:missing"))
  );
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

  const contextPath = path.join(aiRulesDir, "cache", "audit-context.json");
  const ruleIrPath = path.join(aiRulesDir, "cache", "rule-ir.json");
  const templatePath = path.join(aiRulesDir, "cache", "ai-rule-report.template.json");
  const contextExists = await fs.readFile(contextPath, "utf8");
  const ruleIrExists = JSON.parse(await fs.readFile(ruleIrPath, "utf8"));
  const templateExists = JSON.parse(await fs.readFile(templatePath, "utf8"));

  assert.match(summary.stderr || "", /audit-context\.json/);
  assert.match(summary.stderr || "", /rule-ir\.json/);
  assert.match(summary.stderr || "", /ai-rule-report\.template\.json/);
  assert.ok(contextExists.includes("\"stack\": \"python-base\""));
  assert.equal(ruleIrExists.stack, "python-base");
  assert.equal(ruleIrExists.rules.length, 3);
  assert.deepEqual(templateExists.violations, []);
});

test("fix explains how to create ai-rule-report.json when missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-fix-missing-report-"));
  await fs.mkdir(path.join(tempDir, ".ai-rules"), { recursive: true });

  const cliPath = path.join(__dirname, "..", "cli", "src", "index.js");
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "fix", "--issueId", "ISSUE-001"], { cwd: tempDir }),
    (err) => {
      const output = `${err.stdout || ""}${err.stderr || ""}`;
      assert.match(output, /ai-rule-report\.json not found/);
      assert.match(output, /save your AI audit result as ai-rule-report\.json/i);
      assert.match(output, /ai-rule-report\.template\.json/);
      return true;
    }
  );
});

test("validate-report warns when evidence references are unknown", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-validate-evidence-"));
  const cacheDir = path.join(tempDir, ".ai-rules", "cache");
  await fs.mkdir(cacheDir, { recursive: true });

  await fs.writeFile(
    path.join(cacheDir, "audit-context.json"),
    JSON.stringify(
      {
        evidence: [
          {
            evidenceId: "evidence:RULE-001",
            matches: [{ matchId: "evidence:RULE-001:match:1" }],
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    path.join(tempDir, "ai-rule-report.json"),
    JSON.stringify(
      {
        violations: [
          {
            issueId: "ISSUE-001",
            ruleId: "RULE-001",
            severity: "WARN",
            evidence: {
              evidenceIds: ["evidence:RULE-001", "evidence:missing"],
            },
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  const cliPath = path.join(__dirname, "..", "cli", "src", "index.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "validate-report"], { cwd: tempDir });

  assert.match(stdout, /unknown evidenceId\(s\): evidence:missing/);
  assert.match(stdout, /Summary: 1 issue\(s\), 0 error\(s\), 2 warning\(s\)/);
});

test("fix --all orders issues by severity and location", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-rules-fix-order-"));
  const aiRulesDir = path.join(tempDir, ".ai-rules");
  const cacheDir = path.join(aiRulesDir, "cache");
  await fs.mkdir(cacheDir, { recursive: true });

  await fs.writeFile(
    path.join(aiRulesDir, "rules-config.json"),
    JSON.stringify({
      rulesFile: ".ai-rules.md",
      enabledRuleIds: ["RULE-001", "RULE-002", "RULE-003"],
      scopes: ["security"],
    }),
    "utf8"
  );

  await fs.writeFile(
    path.join(aiRulesDir, ".ai-rules.md"),
    [
      "### RULE: RULE-001",
      "severity: WARN",
      "scope: security",
      "intent: Warn issue",
      "detect:",
      "  regex: \"warn\"",
      "fix: Fix warn",
      "prompt:",
      "  violation: Warn",
      "  requirement: Warn requirement",
      "  solution: Warn solution",
      "",
      "### RULE: RULE-002",
      "severity: FATAL",
      "scope: security",
      "intent: Fatal issue",
      "detect:",
      "  regex: \"fatal\"",
      "fix: Fix fatal",
      "prompt:",
      "  violation: Fatal",
      "  requirement: Fatal requirement",
      "  solution: Fatal solution",
      "",
      "### RULE: RULE-003",
      "severity: INFO",
      "scope: security",
      "intent: Info issue",
      "detect:",
      "  regex: \"info\"",
      "fix: Fix info",
      "prompt:",
      "  violation: Info",
      "  requirement: Info requirement",
      "  solution: Info solution",
      "",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(path.join(cacheDir, "audit-context.json"), JSON.stringify({ evidence: [] }, null, 2), "utf8");

  await fs.writeFile(
    path.join(tempDir, "ai-rule-report.json"),
    JSON.stringify(
      {
        violations: [
          {
            issueId: "ISSUE-INFO",
            ruleId: "RULE-003",
            severity: "INFO",
            file: "src/z.ts",
            line: 30,
            description: "info issue",
            repairPrompt: "fix info",
          },
          {
            issueId: "ISSUE-WARN",
            ruleId: "RULE-001",
            severity: "WARN",
            file: "src/b.ts",
            line: 20,
            description: "warn issue",
            repairPrompt: "fix warn",
          },
          {
            issueId: "ISSUE-FATAL",
            ruleId: "RULE-002",
            severity: "FATAL",
            file: "src/a.ts",
            line: 10,
            description: "fatal issue",
            repairPrompt: "fix fatal",
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  const cliPath = path.join(__dirname, "..", "cli", "src", "index.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "fix", "--all"], { cwd: tempDir });

  assert.ok(stdout.indexOf("Rule: RULE-002 | IssueId: ISSUE-FATAL") < stdout.indexOf("Rule: RULE-001 | IssueId: ISSUE-WARN"));
  assert.ok(stdout.indexOf("Rule: RULE-001 | IssueId: ISSUE-WARN") < stdout.indexOf("Rule: RULE-003 | IssueId: ISSUE-INFO"));
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
