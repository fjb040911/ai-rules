const path = require("path");
const fs = require("fs/promises");

function buildSkillInstallManifest({ cwd, provider, locale, targets }) {
  return {
    version: readCliVersion(),
    generatedAt: new Date().toISOString(),
    provider: provider.value,
    projectRoot: cwd,
    locale,
    skills: targets.map((target) => buildSkillRecord(target)),
  };
}

function buildSkillRecord(target) {
  const definition = getSkillDefinition(target.command);
  return {
    name: definition.name,
    workflow: target.command,
    path: target.path,
    execution: definition.execution,
    outputFile: definition.outputFile,
    cacheArtifacts: definition.cacheArtifacts,
  };
}

function getSkillDefinition(command) {
  const definitions = {
    audit: {
      name: "law-audit",
      execution: "ai-law audit --locale <locale>",
      outputFile: "ai-rule-report.json",
      cacheArtifacts: [
        ".ai-rules/cache/audit-context.json",
        ".ai-rules/cache/rule-ir.json",
        ".ai-rules/cache/rule-validator.json",
        ".ai-rules/cache/ai-rule-report.template.json",
      ],
    },
    fix: {
      name: "law-fix",
      execution: "ai-law validate-report && ai-law fix --issueId <ISSUE_ID>",
      outputFile: null,
      cacheArtifacts: [
        "ai-rule-report.json",
        ".ai-rules/cache/rule-ir.json",
        ".ai-rules/cache/rule-validator.json",
      ],
    },
    logic: {
      name: "law-logic",
      execution: "ai-law inspect-logic --locale <locale>",
      outputFile: "ai-logic-report.json",
      cacheArtifacts: [
        ".ai-rules/cache/logic-audit-context.json",
        ".ai-rules/cache/rule-ir.json",
        ".ai-rules/cache/rule-validator.json",
        ".ai-rules/cache/ai-logic-report.template.json",
      ],
    },
    native: {
      name: "law-native",
      execution: "ai-law inspect-logic --locale <locale> --profile native",
      outputFile: "ai-native-report.json",
      cacheArtifacts: [
        ".ai-rules/cache/native-audit-context.json",
        ".ai-rules/cache/rule-ir.json",
        ".ai-rules/cache/rule-validator.json",
        ".ai-rules/cache/ai-native-report.template.json",
      ],
    },
    model: {
      name: "law-model",
      execution: "ai-law inspect-logic --locale <locale> --profile model",
      outputFile: "ai-model-report.json",
      cacheArtifacts: [
        ".ai-rules/cache/model-audit-context.json",
        ".ai-rules/cache/rule-ir.json",
        ".ai-rules/cache/rule-validator.json",
        ".ai-rules/cache/ai-model-report.template.json",
      ],
    },
  };
  if (!definitions[command]) {
    throw new Error(`Unknown skill workflow: ${command}`);
  }
  return definitions[command];
}

async function writeSkillInstallManifest({ cwd, manifest }) {
  const cacheDir = path.join(cwd, ".ai-rules", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  const manifestPath = path.join(cacheDir, "skill-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifestPath;
}

async function readSkillInstallManifest(cwd) {
  const manifestPath = path.join(cwd, ".ai-rules", "cache", "skill-manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    return { manifestPath, manifest };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { manifestPath, manifest: null };
    }
    throw err;
  }
}

function readCliVersion() {
  try {
    return require(path.join(__dirname, "..", "..", "..", "package.json")).version || "unknown";
  } catch {
    return "unknown";
  }
}

module.exports = {
  buildSkillInstallManifest,
  getSkillDefinition,
  writeSkillInstallManifest,
  readSkillInstallManifest,
};
