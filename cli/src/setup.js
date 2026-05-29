const path = require("path");
const fs = require("fs/promises");
const inquirer = require("inquirer");
const { readLocaleMap } = require("./utils/templates");
const { writeOutput } = require("./utils/output");
const {
  buildSkillInstallManifest,
  getSkillDefinition,
  writeSkillInstallManifest,
} = require("./core/skills/manifest");

const prompt = inquirer.prompt || (inquirer.default && inquirer.default.prompt);

const MANAGED_START = "<!-- AI-LAW:START -->";
const MANAGED_END = "<!-- AI-LAW:END -->";

/** Claude Code Bash allow rule for `` !`ai-law …` `` skill injection */
const AI_LAW_BASH_ALLOW = "Bash(ai-law:*)";
const AI_LAW_BASH_ALLOW_ALT = "Bash(ai-law *)";
const SKILL_WORKFLOWS = ["audit", "fix", "logic", "native", "model"];

const PROVIDERS = [
  { value: "copilot", label: "GitHub Copilot", supportsSlash: true },
  { value: "codex", label: "OpenAI Codex", supportsSlash: true },
  { value: "cursor", label: "Cursor", supportsSlash: true },
  { value: "claude-code", label: "Claude Code", supportsSlash: true },
  { value: "custom", label: "Custom (generic)", supportsSlash: false },
];

function coerceProviderInput(raw) {
  if (raw == null || raw === "" || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = resolveProvider(trimmed);
  if (resolved) {
    return resolved.value;
  }
  const displayMap = {
    "github copilot": "copilot",
    "openai codex": "codex",
    "claude code": "claude-code",
    "custom (generic)": "custom",
  };
  return displayMap[trimmed.toLowerCase()] || trimmed;
}

async function runSetup(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const locale = parseLocaleArg(argv) || "en";
  const localeMap = await readLocaleMap(locale);
  const providerArgRaw = parseProviderArg(argv);
  const providerArg = providerArgRaw ? coerceProviderInput(providerArgRaw) : null;
  const shouldWrite = argv.includes("--write");
  const provider = providerArg ? resolveProvider(providerArg) : await selectProvider();

  if (!provider) {
    process.stderr.write(
      "Invalid provider. Use one of: copilot, codex, cursor, claude-code, custom\n"
    );
    process.exitCode = 1;
    return;
  }

  const setupPrompt = buildSetupPrompt(localeMap, provider);

  if (shouldWrite) {
    const { writtenFiles, manifestPath } = await writeProviderSlashFiles({
      cwd,
      provider,
      localeMap,
      locale,
    });

    process.stdout.write(`Provider: ${provider.label}\n`);
    process.stdout.write(`Project root: ${cwd}\n`);
    process.stdout.write("Slash / skill files updated:\n");
    for (const filePath of [...writtenFiles, manifestPath]) {
      process.stdout.write(`- ${filePath}\n`);
    }
    process.stdout.write("\n");

    if (provider.value === "claude-code") {
      await ensureClaudeCodeAiLawBashPermission(cwd);
    }
  }

  process.stdout.write(`Provider: ${provider.label}\n`);
  writeOutput(setupPrompt);
}

function hasAiLawBashAllowEntry(allow) {
  if (!Array.isArray(allow)) {
    return false;
  }
  return allow.some(
    (entry) => entry === AI_LAW_BASH_ALLOW || entry === AI_LAW_BASH_ALLOW_ALT
  );
}

async function ensureClaudeCodeAiLawBashPermission(cwd) {
  const claudeDir = path.join(cwd, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");
  await fs.mkdir(claudeDir, { recursive: true });

  let data = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    data = JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      process.stderr.write(
        `Warning: could not parse .claude/settings.local.json (${String(err.message)}). Skipping ai-law Bash permission merge.\n`
      );
      return;
    }
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    process.stderr.write(
      "Warning: .claude/settings.local.json must be a JSON object. Skipping ai-law Bash permission merge.\n"
    );
    return;
  }

  if (!data.permissions || typeof data.permissions !== "object" || data.permissions === null) {
    data.permissions = {};
  }
  if (!Array.isArray(data.permissions.allow)) {
    data.permissions.allow = [];
  }

  if (hasAiLawBashAllowEntry(data.permissions.allow)) {
    return;
  }

  data.permissions.allow.push(AI_LAW_BASH_ALLOW);
  await fs.writeFile(settingsPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  process.stdout.write(
    `Merged ${AI_LAW_BASH_ALLOW} into .claude/settings.local.json (permissions.allow).\n`
  );
}

function parseLocaleArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--locale" || arg === "-l") {
      return argv[i + 1];
    }
  }
  return null;
}

function parseProviderArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--provider" || arg === "-p") {
      return argv[i + 1];
    }
  }
  return null;
}

function resolveProvider(value) {
  return PROVIDERS.find((item) => item.value === value) || null;
}

async function selectProvider() {
  const { provider } = await prompt([
    {
      type: "list",
      name: "provider",
      message: "Select AI coding tool",
      choices: PROVIDERS.map((item) => ({ name: item.label, value: item.value })),
    },
  ]);

  return resolveProvider(provider);
}

function buildSetupPrompt(localeMap, provider) {
  const key = `prompt.setup.${provider.value}`;
  const setupPrompt = resolve(localeMap, key);
  if (provider.supportsSlash) {
    return setupPrompt;
  }

  const hint = resolve(localeMap, "prompt.setup.noSlashHint");
  return `${setupPrompt}\n\n${hint}`;
}

async function writeProviderSlashFiles({ cwd, provider, localeMap, locale }) {
  await cleanupLegacyProviderPaths(cwd, provider);
  const targets = getSlashTargets(cwd, provider);
  const outputs = [];

  for (const target of targets) {
    const content = buildSlashFileContent(localeMap, provider, target.command, locale);
    await fs.mkdir(path.dirname(target.path), { recursive: true });
    await writeManagedFile(target.path, content);
    outputs.push(target.path);
  }

  const manifest = buildSkillInstallManifest({ cwd, provider, locale, targets });
  const manifestPath = await writeSkillInstallManifest({ cwd, manifest });

  return {
    writtenFiles: outputs,
    manifestPath,
  };
}

async function cleanupLegacyProviderPaths(cwd, provider) {
  const legacy = [];
  if (provider.value === "claude-code") {
    legacy.push(...buildLegacyPaths(path.join(cwd, ".claude", "commands")));
    legacy.push(
      path.join(cwd, ".claude", "commands", "law", "audit.md"),
      path.join(cwd, ".claude", "commands", "law", "fix.md"),
      path.join(cwd, ".claude", "commands", "law", "logic.md")
    );
  }
  if (provider.value === "cursor") {
    legacy.push(...buildLegacyPaths(path.join(cwd, ".cursor", "commands")));
  }
  if (provider.value === "codex") {
    const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || cwd, ".codex");
    legacy.push(...buildLegacyPaths(path.join(codexHome, "prompts")));
  }
  if (provider.value === "custom") {
    legacy.push(...buildLegacyPaths(path.join(cwd, ".ai-rules", "slash-prompts")));
  }
  for (const filePath of legacy) {
    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore */
    }
  }
}

function buildLegacyPaths(root) {
  return SKILL_WORKFLOWS.map((command) =>
    path.join(root, `${getSkillDefinition(command).name}.md`)
  );
}

function getSlashTargets(cwd, provider) {
  if (provider.value === "copilot") {
    return SKILL_WORKFLOWS.map((command) => ({
      command,
      path: path.join(
        cwd,
        ".github",
        "prompts",
        `${getSkillDefinition(command).name}.prompt.md`
      ),
    }));
  }

  if (provider.value === "cursor") {
    return SKILL_WORKFLOWS.map((command) => ({
      command,
      path: path.join(cwd, ".cursor", "skills", getSkillDefinition(command).name, "SKILL.md"),
    }));
  }

  if (provider.value === "claude-code") {
    return SKILL_WORKFLOWS.map((command) => ({
      command,
      path: path.join(cwd, ".claude", "skills", getSkillDefinition(command).name, "SKILL.md"),
    }));
  }

  if (provider.value === "codex") {
    const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || cwd, ".codex");
    return SKILL_WORKFLOWS.map((command) => ({
      command,
      path: path.join(codexHome, "skills", getSkillDefinition(command).name, "SKILL.md"),
    }));
  }

  return SKILL_WORKFLOWS.map((command) => ({
    command,
    path: path.join(cwd, ".ai-rules", "skills", getSkillDefinition(command).name, "SKILL.md"),
  }));
}

function buildSlashFileContent(localeMap, provider, command, locale) {
  const definition = getSkillDefinition(command);
  const slashName = definition.name;
  const description = resolveSkillDescription(command);

  if (provider.value === "claude-code") {
    return buildClaudeCodeSkillContent({ command, slashName, description, locale });
  }

  if (provider.value === "cursor" || provider.value === "codex" || provider.value === "custom") {
    const argumentHint = command === "fix" ? "<ISSUE_ID>" : "[optional-focus]";
    return buildPromptBackedAgentSkill({
      slashName,
      description,
      argumentHint,
      localeMap,
      command,
      locale,
    });
  }

  if (provider.value === "copilot") {
    const managedBody = [MANAGED_START, buildPromptBackedWorkflowBody({ command, localeMap, locale }), MANAGED_END].join("\n");
    return [
      "---",
      `description: ${description}`,
      `command: /${slashName}`,
      "---",
      "",
      managedBody,
      "",
    ].join("\n");
  }

  throw new Error(`Unexpected provider for slash content: ${provider.value}`);
}

function buildPromptBackedAgentSkill({
  slashName,
  description,
  argumentHint,
  localeMap,
  command,
  locale,
}) {
  const inner = buildPromptBackedWorkflowBody({ command, localeMap, locale });
  const managedBody = [MANAGED_START, inner, MANAGED_END].join("\n");
  return [
    "---",
    `name: ${slashName}`,
    `description: ${description}`,
    `argument-hint: ${argumentHint}`,
    "---",
    "",
    `# /${slashName}`,
    "",
    managedBody,
    "",
  ].join("\n");
}

function buildPromptBackedWorkflowBody({ command, localeMap, locale }) {
  if (command === "audit") {
    return resolve(localeMap, "prompt.audit.cli");
  }
  if (command === "fix") {
    return [
      "Ask user for issueId.",
      "Run: ai-law validate-report",
      "Run: ai-law fix --issueId <ISSUE_ID>",
      "Use the copied prompt to generate minimal patch-ready edits.",
    ].join("\n");
  }
  if (command === "logic") {
    return resolve(localeMap, "prompt.logic.cli");
  }
  if (command === "native") {
    return [
      `Run: ai-law inspect-logic --locale ${locale} --profile native`,
      "Use .ai-rules/cache/native-audit-context.json, rule-ir.json, rule-validator.json, and ai-native-report.template.json as the source of truth.",
      "Return strict JSON only and save it as ai-native-report.json in the project root.",
      "Focus on DMA, ownership/lifetime, return-value handling, protocol validation, and trust-boundary issues in native code.",
    ].join("\n");
  }
  return [
    `Run: ai-law inspect-logic --locale ${locale} --profile model`,
    "Use .ai-rules/cache/model-audit-context.json, rule-ir.json, rule-validator.json, and ai-model-report.template.json as the source of truth.",
    "Return strict JSON only and save it as ai-model-report.json in the project root.",
    "Focus on model input contracts, precision/device drift, checkpoint handling, runtime mode, and evaluation consistency.",
  ].join("\n");
}

function buildClaudeCodeSkillContent({ command, slashName, description, locale }) {
  const frontmatter = [
    "---",
    `name: ${slashName}`,
    `description: ${description}`,
    `argument-hint: ${command === "fix" ? "<ISSUE_ID>" : "[optional-focus]"}`,
    "---",
  ];

  const body =
    command === "audit"
      ? [
          MANAGED_START,
          `# /${slashName}`,
          "",
          `Run \`ai-law audit --locale ${locale}\` first, use the generated prompt and cache artifacts as the source of truth, then write the final strict JSON report to \`ai-rule-report.json\` in the project root.`,
          "",
          "## Step 1: Run the local AI-RULES audit command",
          `!\`ai-law audit --locale ${locale}\``,
          "",
          "## Step 2: Use the generated cache artifacts as context",
          "- @.ai-rules/cache/audit-context.json",
          "- @.ai-rules/cache/rule-ir.json",
          "- @.ai-rules/cache/rule-validator.json",
          "- @.ai-rules/cache/ai-rule-report.template.json",
          "",
          "## Step 3: Produce the audit result",
          "- Return strict JSON only.",
          "- Save the final JSON as @ai-rule-report.json in the project root.",
          "- If optional arguments are provided, treat `$ARGUMENTS` as extra audit focus context.",
          MANAGED_END,
        ]
      : command === "fix"
        ? [
            MANAGED_START,
            `# /${slashName}`,
            "",
            "Use the existing validated report and local rule artifacts to generate a focused fix prompt for one issue.",
            "",
            "## Required argument",
            "- Issue ID: `$ARGUMENTS`",
            "",
            "## Before CLI steps",
            "- If `$ARGUMENTS` is empty or whitespace-only, stop and ask for a concrete issue ID. Do not run the commands below until you have one.",
            "",
            "## Step 1: Ensure the report is normalized",
            "!\`ai-law validate-report\`",
            "",
            "## Step 2: Generate the fix prompt for the selected issue",
            "!\`ai-law fix --issueId $ARGUMENTS\`",
            "",
            "## Step 3: Apply the fix workflow",
            "- Use the generated fix prompt as the source of truth.",
            "- Make minimal, architecture-preserving edits only for the selected issue.",
            MANAGED_END,
          ]
        : [
            MANAGED_START,
            `# /${slashName}`,
            "",
            ...buildClaudeLogicBody({ command, locale }),
            MANAGED_END,
          ];

  return [...frontmatter, "", ...body, ""].join("\n");
}

function buildClaudeLogicBody({ command, locale }) {
  const mapping = {
    logic: {
      run: `ai-law inspect-logic --locale ${locale}`,
      contextFile: "logic-audit-context.json",
      templateFile: "ai-logic-report.template.json",
      outputFile: "ai-logic-report.json",
      focusNote: "If optional arguments are provided, treat `$ARGUMENTS` as extra business-risk focus context.",
      intro:
        `Run \`ai-law inspect-logic --locale ${locale}\` first, use the generated logic audit context as the source of truth, then write the final strict JSON report to \`ai-logic-report.json\` in the project root.`,
    },
    native: {
      run: `ai-law inspect-logic --locale ${locale} --profile native`,
      contextFile: "native-audit-context.json",
      templateFile: "ai-native-report.template.json",
      outputFile: "ai-native-report.json",
      focusNote:
        "If optional arguments are provided, treat `$ARGUMENTS` as extra native/runtime risk focus context.",
      intro:
        `Run \`ai-law inspect-logic --locale ${locale} --profile native\` first, use the generated native audit context as the source of truth, then write the final strict JSON report to \`ai-native-report.json\` in the project root.`,
    },
    model: {
      run: `ai-law inspect-logic --locale ${locale} --profile model`,
      contextFile: "model-audit-context.json",
      templateFile: "ai-model-report.template.json",
      outputFile: "ai-model-report.json",
      focusNote:
        "If optional arguments are provided, treat `$ARGUMENTS` as extra model-pipeline risk focus context.",
      intro:
        `Run \`ai-law inspect-logic --locale ${locale} --profile model\` first, use the generated model audit context as the source of truth, then write the final strict JSON report to \`ai-model-report.json\` in the project root.`,
    },
  };
  const current = mapping[command] || mapping.logic;
  return [
    current.intro,
    "",
    "## Step 1: Run the local inspection command",
    `!\`${current.run}\``,
    "",
    "## Step 2: Use the generated cache artifacts as context",
    `- @.ai-rules/cache/${current.contextFile}`,
    "- @.ai-rules/cache/rule-ir.json",
    "- @.ai-rules/cache/rule-validator.json",
    `- @.ai-rules/cache/${current.templateFile}`,
    "",
    "## Step 3: Produce the inspection report",
    "- Return strict JSON only.",
    `- Save the final JSON as @${current.outputFile} in the project root.`,
    `- ${current.focusNote}`,
  ];
}

function resolveSkillDescription(command) {
  const descriptions = {
    audit: "Run architecture audit and output ai-rule-report.json",
    fix: "Fix a single issue by issueId using ai-law fix",
    logic: "Inspect business-logic risks and output ai-logic-report.json",
    native: "Inspect native/runtime risks and output ai-native-report.json",
    model: "Inspect model-pipeline risks and output ai-model-report.json",
  };
  return descriptions[command] || command;
}

async function writeManagedFile(targetPath, managedContent) {
  const exists = await fileExists(targetPath);
  if (!exists) {
    await fs.writeFile(targetPath, managedContent, "utf8");
    return;
  }

  const existing = await fs.readFile(targetPath, "utf8");
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start >= 0 && end > start) {
    const prefix = existing.slice(0, start);
    const suffix = existing.slice(end + MANAGED_END.length);
    const managedBlock = extractManagedBlock(managedContent);
    await fs.writeFile(targetPath, `${prefix}${managedBlock}${suffix}`, "utf8");
    return;
  }

  const next = existing.endsWith("\n")
    ? `${existing}\n${extractManagedBlock(managedContent)}\n`
    : `${existing}\n\n${extractManagedBlock(managedContent)}\n`;
  await fs.writeFile(targetPath, next, "utf8");
}

function extractManagedBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start < 0 || end < start) {
    return content;
  }
  return content.slice(start, end + MANAGED_END.length);
}

function resolve(localeMap, key) {
  return localeMap[key] || key;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  AI_LAW_BASH_ALLOW,
  AI_LAW_BASH_ALLOW_ALT,
  runSetup,
  writeProviderSlashFiles,
  ensureClaudeCodeAiLawBashPermission,
  coerceProviderInput,
  resolveProvider,
  readLocaleMap,
  buildSlashFileContent,
  getSlashTargets,
  hasAiLawBashAllowEntry,
};
