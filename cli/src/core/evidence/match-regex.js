function matchRegex({ rule, filePath, content }) {
  const pattern = rule.detect && rule.detect.regex;
  if (!pattern) {
    return [];
  }

  let regex;
  try {
    regex = new RegExp(pattern, "g");
  } catch {
    return [
      {
        file: filePath,
        line: 1,
        snippet: `Invalid regex pattern: ${pattern}`,
        note: "invalid-regex",
      },
    ];
  }

  const lines = content.split(/\r?\n/);
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    regex.lastIndex = 0;
    if (regex.test(line)) {
      matches.push({
        file: filePath,
        line: index + 1,
        snippet: line.trim() || line,
      });
    }
  }

  return matches;
}

module.exports = {
  matchRegex,
};
