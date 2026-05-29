const fs = require("fs/promises");
const path = require("path");
const { matchesGlob, normalizePath } = require("./glob");

/** Directory names skipped during the default workspace walk (always, not via glob). */
const SKIP_TRAVERSE_DIR_NAMES = new Set(["node_modules", ".git"]);

async function collectFiles({ cwd, include = [], exclude = [] }) {
  const allFiles = await walkFiles(cwd, cwd);
  return allFiles.filter((relativePath) => {
    const normalized = normalizePath(relativePath);
    const included = include.length === 0 || include.some((pattern) => matchesGlob(normalized, pattern));
    const excluded = exclude.some((pattern) => matchesGlob(normalized, pattern));
    return included && !excluded;
  });
}

async function walkFiles(rootDir, currentDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (SKIP_TRAVERSE_DIR_NAMES.has(entry.name)) {
        continue;
      }
      files.push(...(await walkFiles(rootDir, fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(normalizePath(relativePath));
    }
  }

  return files;
}

module.exports = {
  collectFiles,
};
