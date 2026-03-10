const path = require("path");
const fs = require("fs/promises");
const inquirer = require("inquirer");
const { readJson } = require("./utils/fs");
const { getTemplatesRoot } = require("./utils/templates");
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
    supportsSlash: false,
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

async function readLocaleMap(locale) {
  const templatesRoot = getTemplatesRoot();
  const localePath = path.join(templatesRoot, "i18n", `${locale}.json`);

  try {
    await fs.access(localePath);
    return readJson(localePath);
  } catch {
    if (locale === "en") {
      throw new Error("Default locale 'en' not found in templates/i18n.");
    }
    const fallbackPath = path.join(templatesRoot, "i18n", "en.json");
    const exists = await fileExists(fallbackPath);
    if (!exists) {
      throw new Error("Fallback locale 'en' not found in templates/i18n.");
    }
    process.stderr.write(`Locale '${locale}' not found. Falling back to en.\n`);
    return readJson(fallbackPath);
  }
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
  ];
}

function buildSlashFileContent(localeMap, provider, command, locale) {
  const slashName = command === "audit" ? "law-audit" : "law-fix";
  const description = command === "audit"
    ? "Run architecture audit and output ai-rule-report.json"
    : "Fix a single issue by issueId using ai-law fix";

  const body = command === "audit"
    ? resolve(localeMap, "prompt.audit.cli")
    : [
        "Ask user for issueId.",
        "Run: ai-law fix --issueId <ISSUE_ID>",
        "Use the copied prompt to generate minimal patch-ready edits.",
      ].join("\n");

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

  if (provider.value === "claude-code") {
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

module.exports = { runSetup, writeProviderSlashFiles, resolveProvider, readLocaleMap };
