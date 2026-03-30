const fs = require("fs/promises");
const path = require("path");
const { collectFiles } = require("./file-set");
const { matchRegex } = require("./match-regex");
const { matchImportLike } = require("./match-import");
const { matchesGlob } = require("./glob");

async function collectEvidence({ cwd, config, rules }) {
  const files = await collectFiles({
    cwd,
    include: (config.detectOptions && config.detectOptions.include) || [],
    exclude: (config.detectOptions && config.detectOptions.exclude) || [],
  });

  const contentCache = new Map();
  const evidence = [];

  for (const rule of rules) {
    const matches = [];
    const sourceFiles = filterFilesForRule(files, rule);

    if (rule.detect && rule.detect.regex) {
      for (const file of sourceFiles) {
        const content = await readFileCached(contentCache, cwd, file);
        matches.push(...matchRegex({ rule, filePath: file, content }));
      }
    } else if (rule.detect && (rule.detect.import || rule.detect.include)) {
      for (const file of sourceFiles) {
        const content = await readFileCached(contentCache, cwd, file);
        matches.push(...matchImportLike({ rule, filePath: file, content }));
      }
    }

    evidence.push(buildEvidenceRecord(rule, matches));
  }

  return evidence;
}

function buildEvidenceRecord(rule, matches) {
  if (rule.detect && rule.detect.regex) {
    return {
      ruleId: rule.id,
      mode: "local-regex",
      matches: matches.slice(0, 10),
      totalMatches: matches.length,
    };
  }

  if (rule.detect && (rule.detect.import || rule.detect.include)) {
    return {
      ruleId: rule.id,
      mode: "local-import",
      matches: matches.slice(0, 10),
      totalMatches: matches.length,
    };
  }

  return {
    ruleId: rule.id,
    mode: "ai-only",
    matches: [],
    totalMatches: 0,
    note: "This rule uses AST or semantic detection and requires AI judgment.",
  };
}

function filterFilesForRule(files, rule) {
  const where = rule.detect && rule.detect.where;
  if (!where) {
    return files;
  }

  const filePathMatch = where.match(/^filePath in (.+)$/);
  if (filePathMatch) {
    return files.filter((file) => matchesGlob(file, filePathMatch[1].trim()));
  }

  const importerMatch = where.match(/^importer in (.+)$/);
  if (importerMatch) {
    return files.filter((file) => matchesGlob(file, importerMatch[1].trim()));
  }

  const includerMatch = where.match(/^includer in (.+)$/);
  if (includerMatch) {
    return files.filter((file) => matchesGlob(file, includerMatch[1].trim()));
  }

  return files;
}

async function readFileCached(cache, cwd, relativePath) {
  if (cache.has(relativePath)) {
    return cache.get(relativePath);
  }

  const content = await fs.readFile(path.join(cwd, relativePath), "utf8");
  cache.set(relativePath, content);
  return content;
}

module.exports = {
  collectEvidence,
};
