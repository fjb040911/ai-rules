const path = require("path");
const fs = require("fs/promises");
const inquirer = require("inquirer");
const prompt = inquirer.prompt || (inquirer.default && inquirer.default.prompt);
const { readJson } = require("./utils/fs");
const {
  writeProviderSlashFiles,
  resolveProvider,
  readLocaleMap: readSetupLocaleMap,
} = require("./setup");
const {
  buildTemplateChoices,
  getTemplatesRoot,
  renderRulesMarkdown,
  renderConfigJson,
} = require("./utils/templates");

async function runInit() {
  const cwd = process.cwd();
  const targetDir = path.join(cwd, ".ai-rules");
  const exists = await fileExists(targetDir);

  if (exists) {
    const { action } = await prompt([
      {
        type: "list",
        name: "action",
        message: ".ai-rules already exists. Overwrite it?",
        choices: [
          { name: "Continue and overwrite", value: "overwrite" },
          { name: "Exit", value: "exit" },
        ],
      },
    ]);

    if (action === "exit") {
      process.stdout.write("Exited.\n");
      return;
    }

    await fs.rm(targetDir, { recursive: true, force: true });
  }

  const templatesRoot = getTemplatesRoot();
  const locale = await selectLocale(templatesRoot);
  const choice = await selectTemplate(templatesRoot);

  await fs.mkdir(targetDir, { recursive: true });

  if (choice.type === "branch") {
    const baseDir = choice.baseDir;
    const branchDir = choice.branchDir;
    const baseOutDir = path.join(targetDir, "base");

    await fs.mkdir(baseOutDir, { recursive: true });
    await writeRuleSet(baseDir, baseOutDir, locale, {
      extendsRules: null,
      extendsConfig: null,
    });

    await writeRuleSet(branchDir, targetDir, locale, {
      extendsRules: "base/.ai-rules.md",
      extendsConfig: "base/rules-config.json",
    });
  } else {
    await writeRuleSet(choice.templateDir, targetDir, locale, {
      extendsRules: null,
      extendsConfig: null,
    });
  }

  process.stdout.write(".ai-rules generated.\n");
  printSuccessBanner();

  await maybeSetupSlashCommands(cwd, locale);
}

async function selectLocale(templatesRoot) {
  const i18nDir = path.join(templatesRoot, "i18n");
  const entries = await fs.readdir(i18nDir, { withFileTypes: true });
  const locales = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name.replace(/\.json$/, ""));

  if (locales.length === 0) {
    throw new Error("No locales found in templates/i18n.");
  }

  const { locale } = await prompt([
    {
      type: "list",
      name: "locale",
      message: "Select locale",
      choices: locales,
    },
  ]);

  return locale;
}

async function selectTemplate(templatesRoot) {
  const choices = await buildTemplateChoices(templatesRoot);

  const { template } = await prompt([
    {
      type: "list",
      name: "template",
      message: "Select template",
      choices,
    },
  ]);

  return template;
}

async function writeRuleSet(templateDir, outDir, locale, override) {
  const rulesPath = path.join(templateDir, ".ai-rules.md");
  const configPath = path.join(templateDir, "rules-config.json");

  const localeMap = await readLocaleMap(locale);
  const renderedRules = await renderRulesMarkdown(rulesPath, localeMap, {
    extendsPath: override.extendsRules,
  });
  const renderedConfig = await renderConfigJson(configPath, localeMap, {
    extendsPath: override.extendsConfig,
  });

  await fs.writeFile(path.join(outDir, ".ai-rules.md"), renderedRules, "utf8");
  await fs.writeFile(
    path.join(outDir, "rules-config.json"),
    JSON.stringify(renderedConfig, null, 2) + "\n",
    "utf8"
  );
}

async function readLocaleMap(locale) {
  const templatesRoot = getTemplatesRoot();
  const localePath = path.join(templatesRoot, "i18n", `${locale}.json`);
  return readJson(localePath);
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function maybeSetupSlashCommands(cwd, locale) {
  const { enableSlash } = await prompt([
    {
      type: "confirm",
      name: "enableSlash",
      message: "Configure slash command files now?",
      default: true,
    },
  ]);

  if (!enableSlash) {
    return;
  }

  const { provider } = await prompt([
    {
      type: "list",
      name: "provider",
      message: "Select AI coding tool for slash setup",
      choices: [
        { name: "GitHub Copilot", value: "copilot" },
        { name: "OpenAI Codex", value: "codex" },
        { name: "Cursor", value: "cursor" },
        { name: "Claude Code", value: "claude-code" },
        { name: "Custom (generic)", value: "custom" },
      ],
    },
  ]);

  const providerInfo = resolveProvider(provider);
  if (!providerInfo) {
    process.stderr.write("Skip slash setup: invalid provider.\n");
    return;
  }

  const localeMap = await readSetupLocaleMap(locale);
  const writtenFiles = await writeProviderSlashFiles({
    cwd,
    provider: providerInfo,
    localeMap,
    locale,
  });

  process.stdout.write("Slash command files updated:\n");
  for (const filePath of writtenFiles) {
    process.stdout.write(`- ${filePath}\n`);
  }
}

function printSuccessBanner() {
  const banner = [
    "",
    "┌─────────────────────────────────────────────────────────────┐",
    "│                                                             │",
    "│       █████╗ ██╗      ██████╗ ██╗   ██╗██╗     ███████╗    │",
    "│      ██╔══██╗██║      ██╔══██╗██║   ██║██║     ██╔════╝    │",
    "│      ███████║██║█████╗██████╔╝██║   ██║██║     █████╗      │",
    "│      ██╔══██║██║╚════╝██╔══██╗██║   ██║██║     ██╔══╝      │",
    "│      ██║  ██║██║      ██║  ██║╚██████╔╝███████╗███████╗    │",
    "│      ╚═╝  ╚═╝╚═╝      ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝    │",
    "│                                                             │",
    "│              AI Rules Initialized Successfully!            │",
    "│                                                             │",
    "└─────────────────────────────────────────────────────────────┘",
    "",
    "📋 Next Steps:",
    "",
    "  1. Run audit to check your code:",
    "     $ ai-law audit",
    "",
    "  2. Fix violations by issueId:",
    "     $ ai-law fix --issueId <ISSUE_ID>",
    "",
    "  3. Configure slash commands (optional):",
    "     $ ai-law setup --write",
    "",
    "  4. Get help anytime:",
    "     $ ai-law -h",
    "",
    "📖 Docs: docs/design-spec-en.md | docs/design-spec-zh.md",
    "",
  ];

  process.stdout.write(banner.join("\n"));
}

module.exports = { runInit };
