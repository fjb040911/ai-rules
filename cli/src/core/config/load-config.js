const path = require("path");
const { readJson } = require("../../utils/fs");

async function loadConfig(configPath) {
  return loadConfigInternal(path.resolve(configPath), new Set());
}

async function loadConfigInternal(configPath, seen) {
  if (seen.has(configPath)) {
    throw new Error(`Circular config extends detected: ${configPath}`);
  }

  seen.add(configPath);
  const raw = await readJson(configPath);
  const basePath = raw.extends
    ? path.resolve(path.dirname(configPath), raw.extends)
    : null;

  let merged = cloneConfig(raw);
  if (basePath) {
    const parent = await loadConfigInternal(basePath, seen);
    merged = mergeConfigs(parent, merged);
  }

  delete merged.extends;
  seen.delete(configPath);
  return merged;
}

function mergeConfigs(parent, child) {
  const merged = {
    ...parent,
    ...child,
    i18n: mergeObjects(parent.i18n, child.i18n),
    pathAliases: mergeObjects(parent.pathAliases, child.pathAliases),
    thresholds: mergeObjects(parent.thresholds, child.thresholds),
    exceptions: mergeStringArrayMap(parent.exceptions, child.exceptions),
    detectOptions: {
      ...parent.detectOptions,
      ...child.detectOptions,
      include: mergeArrays(parent.detectOptions && parent.detectOptions.include, child.detectOptions && child.detectOptions.include),
      exclude: mergeArrays(parent.detectOptions && parent.detectOptions.exclude, child.detectOptions && child.detectOptions.exclude),
    },
    prompt: mergePrompt(parent.prompt, child.prompt),
    enabledRuleIds: mergeArrays(parent.enabledRuleIds, child.enabledRuleIds),
    scopes: mergeArrays(parent.scopes, child.scopes),
  };

  return merged;
}

function mergePrompt(parent, child) {
  return {
    ...parent,
    ...child,
    promptTemplates: mergeObjects(parent && parent.promptTemplates, child && child.promptTemplates),
    promptTemplateKeys: mergeObjects(parent && parent.promptTemplateKeys, child && child.promptTemplateKeys),
  };
}

function mergeObjects(parent, child) {
  return {
    ...(parent || {}),
    ...(child || {}),
  };
}

function mergeArrays(parent, child) {
  const values = [];
  for (const item of parent || []) {
    if (!values.includes(item)) {
      values.push(item);
    }
  }
  for (const item of child || []) {
    if (!values.includes(item)) {
      values.push(item);
    }
  }
  return values;
}

function mergeStringArrayMap(parent, child) {
  const merged = {
    ...(parent || {}),
  };

  for (const [key, value] of Object.entries(child || {})) {
    merged[key] = mergeArrays(merged[key], value);
  }

  return merged;
}

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  loadConfig,
  mergeConfigs,
};
