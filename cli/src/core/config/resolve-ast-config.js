const fs = require("fs/promises");
const path = require("path");
const { readJson } = require("../../utils/fs");

async function resolveAstConfig({ cwd, config }) {
  const defaults = defaultAstConfigForStack(config && config.stack);
  const detected = (config && config.ast && config.ast.useProjectConfig === false)
    ? {}
    : await detectProjectAstConfig(cwd);
  const overrides = (config && config.ast) || {};

  const resolved = mergeAstConfig(mergeAstConfig(defaults, detected), overrides);
  const sources = collectSources(defaults, detected, overrides);

  if (!resolved.provider) {
    return null;
  }

  return {
    ...resolved,
    sources,
  };
}

function defaultAstConfigForStack(stack) {
  switch (stack) {
    case "react-ts":
      return {
        provider: "babel",
        target: "react",
        useProjectConfig: true,
        parserOptions: {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        },
        defaultsApplied: true,
      };
    case "react-js":
      return {
        provider: "babel",
        target: "react",
        useProjectConfig: true,
        parserOptions: {
          sourceType: "module",
          plugins: ["jsx"],
        },
        defaultsApplied: true,
      };
    case "vue":
      return {
        provider: "vue-sfc",
        target: "vue",
        scriptParser: "babel",
        useProjectConfig: true,
        parserOptions: {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        },
        defaultsApplied: true,
      };
    case "frontend-base":
      return {
        provider: "babel",
        target: "frontend",
        useProjectConfig: true,
        parserOptions: {
          sourceType: "module",
          plugins: ["jsx"],
        },
        defaultsApplied: true,
      };
    default:
      return {};
  }
}

async function detectProjectAstConfig(cwd) {
  const result = {
    parserOptions: {},
    detectedFrom: [],
  };

  const tsconfig = await readJsonIfExists(path.join(cwd, "tsconfig.json"));
  if (tsconfig && tsconfig.compilerOptions) {
    const plugins = [];
    const jsx = tsconfig.compilerOptions.jsx;
    if (jsx && jsx !== "preserve") {
      plugins.push("jsx");
    } else if (jsx) {
      plugins.push("jsx");
    }
    if (tsconfig.compilerOptions.allowJs || tsconfig.compilerOptions.checkJs || tsconfig.compilerOptions.jsx || tsconfig.compilerOptions.types) {
      plugins.push("typescript");
    }
    if (tsconfig.compilerOptions.experimentalDecorators) {
      plugins.push("decorators-legacy");
    }
    result.parserOptions = mergeParserOptions(result.parserOptions, {
      plugins,
    });
    result.detectedFrom.push("tsconfig.json");
  }

  const packageJson = await readJsonIfExists(path.join(cwd, "package.json"));
  if (packageJson) {
    const packageDerived = inferAstFromPackageJson(packageJson);
    result.parserOptions = mergeParserOptions(result.parserOptions, packageDerived.parserOptions);
    if (packageDerived.target && !result.target) {
      result.target = packageDerived.target;
    }
    if (packageDerived.provider && !result.provider) {
      result.provider = packageDerived.provider;
    }
    if (packageDerived.detected) {
      result.detectedFrom.push(...packageDerived.detected);
    }
  }

  const babelConfig = await readJsonIfExists(path.join(cwd, ".babelrc"))
    || await readJsonIfExists(path.join(cwd, ".babelrc.json"))
    || await readJsonIfExists(path.join(cwd, "babel.config.json"));
  if (babelConfig) {
    const inferred = inferAstFromBabelConfig(babelConfig);
    result.provider = result.provider || "babel";
    result.parserOptions = mergeParserOptions(result.parserOptions, inferred.parserOptions);
    result.detectedFrom.push(inferred.source);
  }

  if (!result.provider && result.detectedFrom.length > 0) {
    result.provider = "babel";
  }

  if (result.detectedFrom.length === 0) {
    delete result.detectedFrom;
  }
  if (Object.keys(result.parserOptions).length === 0) {
    delete result.parserOptions;
  }

  return result;
}

function inferAstFromPackageJson(packageJson) {
  const parserOptions = {};
  const detected = [];
  let target = null;
  let provider = null;
  const deps = Object.assign(
    {},
    packageJson.dependencies || {},
    packageJson.devDependencies || {},
    packageJson.peerDependencies || {}
  );
  const depNames = Object.keys(deps);

  if (packageJson.babel) {
    const inferred = inferAstFromBabelConfig(packageJson.babel);
    provider = "babel";
    Object.assign(parserOptions, inferred.parserOptions);
    detected.push("package.json#babel");
  }

  if (depNames.some((name) => name === "react" || name.startsWith("@types/react"))) {
    parserOptions.plugins = mergeArrays(parserOptions.plugins, ["jsx"]);
    target = target || "react";
    detected.push("package.json#react");
  }

  if (depNames.some((name) => name === "vue" || name.startsWith("@vue/"))) {
    provider = provider || "vue-sfc";
    target = target || "vue";
    detected.push("package.json#vue");
  }

  if (depNames.some((name) => name === "typescript" || name.startsWith("@types/"))) {
    parserOptions.plugins = mergeArrays(parserOptions.plugins, ["typescript"]);
    detected.push("package.json#typescript");
  }

  return {
    provider,
    target,
    parserOptions,
    detected: dedupe(detected),
  };
}

function inferAstFromBabelConfig(config) {
  const names = [];
  for (const preset of config.presets || []) {
    names.push(normalizeBabelEntryName(preset));
  }
  for (const plugin of config.plugins || []) {
    names.push(normalizeBabelEntryName(plugin));
  }

  const parserPlugins = [];
  if (names.some((name) => /react|jsx/.test(name))) {
    parserPlugins.push("jsx");
  }
  if (names.some((name) => /typescript/.test(name))) {
    parserPlugins.push("typescript");
  }
  if (names.some((name) => /decorator/.test(name))) {
    parserPlugins.push("decorators-legacy");
  }

  return {
    source: "babel-config",
    parserOptions: {
      plugins: parserPlugins,
    },
  };
}

function normalizeBabelEntryName(entry) {
  if (Array.isArray(entry)) {
    return String(entry[0] || "").toLowerCase();
  }
  return String(entry || "").toLowerCase();
}

function mergeAstConfig(parent, child) {
  return {
    ...(parent || {}),
    ...(child || {}),
    parserOptions: mergeParserOptions(parent && parent.parserOptions, child && child.parserOptions),
    detectedFrom: mergeArrays(parent && parent.detectedFrom, child && child.detectedFrom),
  };
}

function mergeParserOptions(parent, child) {
  return {
    ...(parent || {}),
    ...(child || {}),
    plugins: mergeArrays(parent && parent.plugins, child && child.plugins),
  };
}

function mergeArrays(parent, child) {
  return dedupe([...(parent || []), ...(child || [])].filter(Boolean));
}

function dedupe(values) {
  return Array.from(new Set(values));
}

function collectSources(defaults, detected, overrides) {
  const sources = [];
  if (defaults && Object.keys(defaults).length > 0) {
    sources.push("defaults");
  }
  for (const source of detected.detectedFrom || []) {
    if (!sources.includes(source)) {
      sources.push(source);
    }
  }
  if (overrides && Object.keys(overrides).length > 0) {
    sources.push("ai-rules-config");
  }
  return sources;
}

async function readJsonIfExists(filePath) {
  try {
    await fs.access(filePath);
    return await readJson(filePath);
  } catch {
    return null;
  }
}

module.exports = {
  resolveAstConfig,
  defaultAstConfigForStack,
  detectProjectAstConfig,
  inferAstFromPackageJson,
  inferAstFromBabelConfig,
  mergeAstConfig,
};
