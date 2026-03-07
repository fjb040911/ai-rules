const path = require("path");
const fs = require("fs/promises");
const inquirer = require("inquirer");
const prompt = inquirer.prompt || (inquirer.default && inquirer.default.prompt);
const { readJson } = require("./utils/fs");
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

module.exports = { runInit };
