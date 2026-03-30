const { matchesGlob } = require("./glob");

function matchImportLike({ rule, filePath, content }) {
  const targetPattern = (rule.detect && (rule.detect.import || rule.detect.include)) || null;
  if (!targetPattern) {
    return [];
  }

  const targetType = rule.detect.import ? "import" : "include";
  const lines = content.split(/\r?\n/);
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const candidates = extractReferences(line, targetType);

    for (const candidate of candidates) {
      if (matchesGlob(candidate, targetPattern)) {
        matches.push({
          file: filePath,
          line: index + 1,
          snippet: line.trim() || line,
          reference: candidate,
        });
      }
    }
  }

  return matches;
}

function extractReferences(line, targetType) {
  const references = [];

  if (targetType === "import") {
    for (const regex of [
      /from\s+["']([^"']+)["']/g,
      /import\s+["']([^"']+)["']/g,
      /require\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
      let match = regex.exec(line);
      while (match) {
        references.push(match[1]);
        match = regex.exec(line);
      }
    }
  }

  if (targetType === "include") {
    const regex = /#include\s+[<"]([^>"]+)[>"]/g;
    let match = regex.exec(line);
    while (match) {
      references.push(match[1]);
      match = regex.exec(line);
    }
  }

  return references;
}

module.exports = {
  matchImportLike,
};
