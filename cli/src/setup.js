const path = require("path");
const fs = require("fs/promises");
const inquirer = require("inquirer");
const { readLocaleMap } = require("./utils/templates");
const { writeOutput } = require("./utils/output");

const prompt = inquirer.prompt || (inquirer.default && inquirer.default.prompt);

const MANAGED_START = "<!-- AI-LAW:START -->";
const MANAGED_END = "<!-- AI-LAW:END -->";

const PROVIDERS = [
  {
    value: "copilot",
    label: "GitHub Copilot",
    supportsSlash: true,
  },
  {
    value: "codex",
    label: "OpenAI Codex",
    supportsSlash: true,
  },
  {
    value: "cursor",
    label: "Cursor",
    supportsSlash: false,
  },
  {
    value: "claude-code",
    label: "Claude Code",
    supportsSlash: true,
  },
  {
    value: "custom",
    label: "Custom (generic)",
    supportsSlash: false,
  },
];

async function runSetup(argv) {
  const locale = parseLocaleArg(argv) || "en";
  const localeMap = await readLocaleMap(locale);
  const providerArg = parseProviderArg(argv);
  const shouldWrite = argv.includes("--write");
  const provider = providerArg
    ? resolveProvider(providerArg)
    : await selectProvider();

  if (!provider) {
    process.stderr.write(
      "Invalid provider. Use one of: copilot, codex, cursor, claude-code, custom\n"
    );
    process.exitCode = 1;
    return;
  }

  const setupPrompt = buildSetupPrompt(localeMap, provider);

  if (shouldWrite) {
    const writtenFiles = await writeProviderSlashFiles({
      cwd: process.cwd(),
      provider,
      localeMap,
      locale,
    });

    process.stdout.write(`Provider: ${provider.label}\n`);
    process.stdout.write("Slash command files updated:\n");
    for (const filePath of writtenFiles) {
      process.stdout.write(`- ${filePath}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(`Provider: ${provider.label}\n`);
  writeOutput(setupPrompt);
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
      choices: PROVIDERS.map((item) => ({
        name: item.label,
        value: item.value,
      })),
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
  const targets = getSlashTargets(cwd, provider);
  const outputs = [];

  for (const target of targets) {
    const content = buildSlashFileContent(localeMap, provider, target.command, locale);
    await fs.mkdir(path.dirname(target.path), { recursive: true });
    await writeManagedFile(target.path, content);
    outputs.push(target.path);
  }

  return outputs;
}

function getSlashTargets(cwd, provider) {
  if (provider.value === "copilot") {
    return [
      {
        command: "audit",
        path: path.join(cwd, ".github", "prompts", "law-audit.prompt.md"),
      },
      {
        command: "fix",
        path: path.join(cwd, ".github", "prompts", "law-fix.prompt.md"),
      },
      {
        command: "logic",
        path: path.join(cwd, ".github", "prompts", "law-logic.prompt.md"),
      },
    ];
  }

  if (provider.value === "cursor") {
    return [
      {
        command: "audit",
        path: path.join(cwd, ".cursor", "commands", "law-audit.md"),
      },
      {
        command: "fix",
        path: path.join(cwd, ".cursor", "commands", "law-fix.md"),
      },
      {
        command: "logic",
        path: path.join(cwd, ".cursor", "commands", "law-logic.md"),
      },
    ];
  }

  if (provider.value === "claude-code") {
    return [
      {
        command: "audit",
        path: path.join(cwd, ".claude", "commands", "law", "audit.md"),
      },
      {
        command: "fix",
        path: path.join(cwd, ".claude", "commands", "law", "fix.md"),
      },
      {
        command: "logic",
        path: path.join(cwd, ".claude", "commands", "law", "logic.md"),
      },
    ];
  }

  if (provider.value === "codex") {
    const codexHome =
      process.env.CODEX_HOME || path.join(process.env.HOME || cwd, ".codex");
    return [
      {
        command: "audit",
        path: path.join(codexHome, "prompts", "law-audit.md"),
      },
      {
        command: "fix",
        path: path.join(codexHome, "prompts", "law-fix.md"),
      },
      {
        command: "logic",
        path: path.join(codexHome, "prompts", "law-logic.md"),
      },
    ];
  }

  return [
    {
      command: "audit",
      path: path.join(cwd, ".ai-rules", "slash-prompts", "law-audit.md"),
    },
    {
      command: "fix",
      path: path.join(cwd, ".ai-rules", "slash-prompts", "law-fix.md"),
    },
    {
      command: "logic",
      path: path.join(cwd, ".ai-rules", "slash-prompts", "law-logic.md"),
    },
  ];
}

function buildSlashFileContent(localeMap, provider, command, locale) {
  const slashName =
    command === "audit" ? "law-audit" : command === "fix" ? "law-fix" : "law-logic";
  const description =
    command === "audit"
      ? "Run architecture audit and output ai-rule-report.json"
      : command === "fix"
        ? "Fix a single issue by issueId using ai-law fix"
        : "Inspect business-logic risks and output ai-logic-report.json";

  if (provider.value === "claude-code") {
    return buildClaudeCodeCommandContent({ command, slashName, description, locale });
  }

  const body = command === "audit"
    ? resolve(localeMap, "prompt.audit.cli")
    : command === "fix"
      ? [
        "Ask user for issueId.",
        "Run: ai-law fix --issueId <ISSUE_ID>",
        "Use the copied prompt to generate minimal patch-ready edits.",
      ].join("\n")
      : resolve(localeMap, "prompt.logic.cli");

  const managedBody = [MANAGED_START, body, MANAGED_END].join("\n");

  if (provider.value === "copilot") {
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

  if (provider.value === "cursor") {
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

  if (provider.value === "codex") {
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

  return [
    `# AI-LAW ${command.toUpperCase()} (${locale})`,
    `# Suggested slash: /${slashName}`,
    "",
    managedBody,
    "",
  ].join("\n");
}

function buildClaudeCodeCommandContent({ command, slashName, description, locale }) {
  const frontmatter = command === "audit"
    ? [
        "---",
        `description: ${description}`,
        "argument-hint: [optional-focus]",
        "allowed-tools: Bash(ai-law audit:*), Read, Write, Edit, MultiEdit",
        "---",
      ]
    : command === "fix"
      ? [
        "---",
        `description: ${description}`,
        "argument-hint: <ISSUE_ID>",
        "allowed-tools: Bash(ai-law validate-report:*), Bash(ai-law fix:*), Read, Write, Edit, MultiEdit",
        "---",
      ]
      : [
        "---",
        `description: ${description}`,
        "argument-hint: [optional-focus]",
        "allowed-tools: Bash(ai-law inspect-logic:*), Read, Write, Edit, MultiEdit",
        "---",
      ];

  const body = command === "audit"
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
        "## Step 1: Ensure the report is normalized",
        "!\`ai-law validate-report\`",
        "",
        "## Step 2: Generate the fix prompt for the selected issue",
        "!\`ai-law fix --issueId $ARGUMENTS\`",
        "",
        "## Step 3: Apply the fix workflow",
        "- If `$ARGUMENTS` is empty, stop and ask for a concrete issue ID before continuing.",
        "- Use the generated fix prompt as the source of truth.",
        "- Make minimal, architecture-preserving edits only for the selected issue.",
        MANAGED_END,
      ]
      : [
        MANAGED_START,
        `# /${slashName}`,
        "",
        `Run \`ai-law inspect-logic --locale ${locale}\` first, use the generated logic audit context as the source of truth, then write the final strict JSON report to \`ai-logic-report.json\` in the project root.`,
        "",
        "## Step 1: Run the local business-logic inspection command",
        `!\`ai-law inspect-logic --locale ${locale}\``,
        "",
        "## Step 2: Use the generated logic cache artifacts as context",
        "- @.ai-rules/cache/logic-audit-context.json",
        "- @.ai-rules/cache/rule-ir.json",
        "- @.ai-rules/cache/rule-validator.json",
        "- @.ai-rules/cache/ai-logic-report.template.json",
        "",
        "## Step 3: Produce the logic risk report",
        "- Return strict JSON only.",
        "- Save the final JSON as @ai-logic-report.json in the project root.",
        "- If optional arguments are provided, treat `$ARGUMENTS` as extra business-risk focus context.",
        MANAGED_END,
      ];

  return [...frontmatter, "", ...body, ""].join("\n");
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
    const merged = `${prefix}${managedBlock}${suffix}`;
    await fs.writeFile(targetPath, merged, "utf8");
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
  runSetup,
  writeProviderSlashFiles,
  resolveProvider,
  readLocaleMap,
  buildSlashFileContent,
};
