const path = require("path");
const fs = require("fs/promises");
const inquirer = require("inquirer");
const prompt = inquirer.prompt || (inquirer.default && inquirer.default.prompt);
const { runSetup, coerceProviderInput } = require("./setup");
const {
  buildTemplateChoices,
  getTemplatesRoot,
  renderRulesMarkdown,
  renderConfigJson,
  renderLocalConfigJson,
  readLocaleMap,
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
  const localeMeta = await readLocaleMeta(i18nDir);
  const locales = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== "locale-meta.json")
    .map((e) => e.name.replace(/\.json$/, ""))
    .sort(sortLocales);

  if (locales.length === 0) {
    throw new Error("No locales found in templates/i18n.");
  }

  const { locale } = await prompt([
    {
      type: "list",
      name: "locale",
      message: "Select locale",
      choices: locales.map((locale) => ({
        name: formatLocaleChoice(locale, localeMeta[locale]),
        value: locale,
      })),
    },
  ]);

  return locale;
}

async function readLocaleMeta(i18nDir) {
  const metaPath = path.join(i18nDir, "locale-meta.json");
  try {
    const content = await fs.readFile(metaPath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function sortLocales(left, right) {
  const priority = ["zh-CN", "en"];
  const leftPriority = priority.indexOf(left);
  const rightPriority = priority.indexOf(right);
  if (leftPriority >= 0 || rightPriority >= 0) {
    return (leftPriority >= 0 ? leftPriority : 99) - (rightPriority >= 0 ? rightPriority : 99);
  }
  return left.localeCompare(right);
}

function formatLocaleChoice(locale, meta) {
  if (!meta) {
    return locale;
  }

  const coverage = meta.coverage === "partial" ? "partial, falls back to English" : "complete";
  return `${locale} - ${meta.label} (${coverage})`;
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
  const localConfigPath = path.join(templateDir, "config.json");

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

  if (await fileExists(localConfigPath)) {
    const renderedLocalConfig = await renderLocalConfigJson(localConfigPath);
    await fs.writeFile(
      path.join(outDir, "config.json"),
      JSON.stringify(renderedLocalConfig, null, 2) + "\n",
      "utf8"
    );
  }
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
      message: "Configure slash / Agent Skills files now?",
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
      message: "Select AI coding tool for slash / Agent Skills setup",
      choices: [
        { name: "GitHub Copilot", value: "copilot" },
        { name: "OpenAI Codex", value: "codex" },
        { name: "Cursor", value: "cursor" },
        { name: "Claude Code", value: "claude-code" },
        { name: "Custom (generic)", value: "custom" },
      ],
    },
  ]);

  const providerId = coerceProviderInput(provider) || String(provider);
  await runSetup(["--provider", providerId, "--locale", String(locale), "--write"], {
    cwd,
  });
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
    "  3. Configure slash / skills (optional):",
    "     $ ai-law setup --provider claude-code --write",
    "",
    "  4. Get help anytime:",
    "     $ ai-law -h",
    "",
    "📖 Docs: design/design-spec-en.md | design/design-spec-zh.md",
    "",
  ];

  process.stdout.write(banner.join("\n"));
}

module.exports = { runInit };
