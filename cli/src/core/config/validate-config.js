const fs = require("fs/promises");
const path = require("path");

async function validateConfig({ config, cwd, configDir }) {
  return [
    ...validateThresholds(config.thresholds),
    ...validateExceptions(config.exceptions),
    ...validateAstConfig(config.ast),
    ...(await validatePathAliases({ pathAliases: config.pathAliases, cwd, configDir })),
  ];
}

function validateThresholds(thresholds) {
  if (!thresholds) {
    return [];
  }

  const findings = [];
  if (typeof thresholds !== "object" || Array.isArray(thresholds)) {
    findings.push({ level: "error", message: "thresholds must be an object map." });
    return findings;
  }

  for (const [key, value] of Object.entries(thresholds)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      findings.push({ level: "error", message: `thresholds.${key} must be a finite number.` });
    }
  }

  return findings;
}

function validateExceptions(exceptions) {
  if (!exceptions) {
    return [];
  }

  const findings = [];
  if (typeof exceptions !== "object" || Array.isArray(exceptions)) {
    findings.push({ level: "error", message: "exceptions must be an object map." });
    return findings;
  }

  for (const [rulePattern, filePatterns] of Object.entries(exceptions)) {
    if (!Array.isArray(filePatterns) || filePatterns.some((item) => typeof item !== "string")) {
      findings.push({ level: "error", message: `exceptions.${rulePattern} must be an array of glob strings.` });
    }
  }

  return findings;
}

function validateAstConfig(ast) {
  if (!ast) {
    return [];
  }

  const findings = [];
  if (typeof ast !== "object" || Array.isArray(ast)) {
    findings.push({ level: "error", message: "ast must be an object map." });
    return findings;
  }

  if (ast.provider != null && typeof ast.provider !== "string") {
    findings.push({ level: "error", message: "ast.provider must be a string." });
  }
  if (ast.target != null && typeof ast.target !== "string") {
    findings.push({ level: "error", message: "ast.target must be a string." });
  }
  if (ast.scriptParser != null && typeof ast.scriptParser !== "string") {
    findings.push({ level: "error", message: "ast.scriptParser must be a string." });
  }
  if (ast.useProjectConfig != null && typeof ast.useProjectConfig !== "boolean") {
    findings.push({ level: "error", message: "ast.useProjectConfig must be a boolean." });
  }
  if (ast.parserOptions != null && (typeof ast.parserOptions !== "object" || Array.isArray(ast.parserOptions))) {
    findings.push({ level: "error", message: "ast.parserOptions must be an object map." });
  }
  if (
    ast.parserOptions &&
    ast.parserOptions.plugins != null &&
    (!Array.isArray(ast.parserOptions.plugins) || ast.parserOptions.plugins.some((item) => typeof item !== "string"))
  ) {
    findings.push({ level: "error", message: "ast.parserOptions.plugins must be an array of strings." });
  }

  return findings;
}

async function validatePathAliases({ pathAliases, cwd, configDir }) {
  if (!pathAliases) {
    return [];
  }

  if (typeof pathAliases !== "object" || Array.isArray(pathAliases)) {
    return [{ level: "error", message: "pathAliases must be an object map." }];
  }

  const findings = [];
  for (const [alias, target] of Object.entries(pathAliases)) {
    if (typeof target !== "string" || target.trim() === "") {
      findings.push({ level: "error", message: `pathAliases.${alias} must be a non-empty path string.` });
      continue;
    }

    const probe = pathAliasProbePath(target);
    if (!probe) {
      continue;
    }

    const absoluteProbe = path.resolve(cwd, probe);
    if (!(await fileExists(absoluteProbe))) {
      findings.push({
        level: "warn",
        message: `IMPORTANT: pathAliases.${alias} points to '${target}', but '${probe}' was not found. Open ${path.relative(cwd, path.join(configDir, "config.json"))} and update this alias for your project layout.`,
      });
    }
  }

  return findings;
}

function pathAliasProbePath(target) {
  const normalized = String(target).replace(/\\/g, "/").replace(/^\.\//, "");
  const wildcardIndex = normalized.search(/[*?{(]/u);
  const candidate = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
  const trimmed = candidate.replace(/\/+$/u, "");
  return trimmed || ".";
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
  validateConfig,
  validateThresholds,
  validateExceptions,
  validateAstConfig,
  validatePathAliases,
  pathAliasProbePath,
};
