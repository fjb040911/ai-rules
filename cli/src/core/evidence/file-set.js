const fs = require("fs/promises");
const path = require("path");
const { matchesGlob, normalizePath } = require("./glob");

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
