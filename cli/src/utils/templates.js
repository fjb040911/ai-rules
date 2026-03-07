const path = require("path");
const fs = require("fs/promises");

function getTemplatesRoot() {
  return path.resolve(__dirname, "..", "..", "..", "templates");
}

async function buildTemplateChoices(templatesRoot) {
  const entries = await fs.readdir(templatesRoot, { withFileTypes: true });
  const choices = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === "i18n") {
      continue;
    }

    if (entry.name.endsWith("-base")) {
      const baseDir = path.join(templatesRoot, entry.name);
      const baseLabel = formatBaseLabel(entry.name);
      choices.push({
        name: baseLabel,
        value: {
          type: "base",
          templateDir: baseDir,
        },
      });

      const branchEntries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const branch of branchEntries) {
        if (!branch.isDirectory()) {
          continue;
        }
        if (branch.name.startsWith(".")) {
          continue;
        }
        if (branch.name === "base") {
          continue;
        }
        if (branch.name.endsWith("-base")) {
          continue;
        }
        choices.push({
          name: branch.name,
          value: {
            type: "branch",
            baseDir,
            branchDir: path.join(baseDir, branch.name),
          },
        });
      }
    } else {
      choices.push({
        name: entry.name,
        value: {
          type: "base",
          templateDir: path.join(templatesRoot, entry.name),
        },
      });
    }
  }

  return choices;
}

function formatBaseLabel(baseDirName) {
  const raw = baseDirName.replace(/-base$/, "");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

async function renderRulesMarkdown(filePath, localeMap, options) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const output = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("titleKey:")) {
      const key = trimmed.split(":").slice(1).join(":").trim();
      output.push(line.replace("titleKey", "title").replace(key, resolve(localeMap, key)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith("descriptionKeys:")) {
      const indent = line.match(/^\s*/)[0];
      output.push(`${indent}description:`);
      i += 1;
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        const key = lines[i].trim().slice(2);
        output.push(`${indent}  - ${resolve(localeMap, key)}`);
        i += 1;
      }
      continue;
    }

    if (trimmed.startsWith("intentKey:")) {
      const key = trimmed.split(":").slice(1).join(":").trim();
      output.push(line.replace("intentKey", "intent").replace(key, resolve(localeMap, key)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith("fixKey:")) {
      const key = trimmed.split(":").slice(1).join(":").trim();
      output.push(line.replace("fixKey", "fix").replace(key, resolve(localeMap, key)));
      i += 1;
      continue;
    }

    if (trimmed.startsWith("promptKeys:")) {
      const indent = line.match(/^\s*/)[0];
      output.push(`${indent}prompt:`);
      i += 1;
      while (i < lines.length && lines[i].trim().match(/^(violation|requirement|solution):/)) {
        const parts = lines[i].trim().split(":");
        const keyName = parts[0].trim();
        const key = parts.slice(1).join(":").trim();
        output.push(`${indent}  ${keyName}: ${resolve(localeMap, key)}`);
        i += 1;
      }
      continue;
    }

    if (trimmed.startsWith("extends:") && options && options.extendsPath) {
      const indent = line.match(/^\s*/)[0];
      output.push(`${indent}extends: ${options.extendsPath}`);
      i += 1;
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join("\n");
}

async function renderConfigJson(filePath, localeMap, options) {
  const content = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(content);

  if (options && options.extendsPath) {
    data.extends = options.extendsPath;
  } else {
    delete data.extends;
  }

  if (data.i18n) {
    delete data.i18n;
  }

  if (data.prompt && data.prompt.promptTemplateKeys) {
    const keys = data.prompt.promptTemplateKeys;
    data.prompt.promptTemplates = {
      auditSystem: resolve(localeMap, keys.auditSystem),
      auditUser: resolve(localeMap, keys.auditUser),
      repairSystem: resolve(localeMap, keys.repairSystem),
      repairUser: resolve(localeMap, keys.repairUser),
    };
    delete data.prompt.promptTemplateKeys;
  }

  return data;
}

function resolve(localeMap, key) {
  return localeMap[key] || key;
}

module.exports = {
  getTemplatesRoot,
  buildTemplateChoices,
  renderRulesMarkdown,
  renderConfigJson,
};
