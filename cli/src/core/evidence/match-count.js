function matchCount({ rule, filePath, content, config }) {
  const countKind = rule.detect && rule.detect.count;
  const threshold = resolveThreshold(rule, config);

  if (!countKind || threshold == null) {
    return [];
  }

  const functions = extractFunctions(filePath, content);
  const matches = [];

  for (const fn of functions) {
    const actual =
      countKind === "function-lines"
        ? fn.lineCount
        : countKind === "params-count"
          ? fn.paramCount
          : null;

    if (actual == null || actual <= threshold) {
      continue;
    }

    matches.push({
      file: filePath,
      line: fn.line,
      snippet: `${fn.signature}  [${countKind}=${actual}, threshold=${threshold}]`,
      metric: countKind,
      actual,
      threshold,
      functionName: fn.name || null,
    });
  }

  return matches;
}

function resolveThreshold(rule, config) {
  const detect = rule.detect || {};

  if (detect.thresholdKey && config && config.thresholds && Number.isFinite(config.thresholds[detect.thresholdKey])) {
    return config.thresholds[detect.thresholdKey];
  }

  if (detect.threshold && Number.isFinite(Number(detect.threshold))) {
    return Number(detect.threshold);
  }

  const fallbackKey =
    detect.count === "function-lines"
      ? "maxFunctionLines"
      : detect.count === "params-count"
        ? "maxParamsCount"
        : null;

  if (fallbackKey && config && config.thresholds && Number.isFinite(config.thresholds[fallbackKey])) {
    return config.thresholds[fallbackKey];
  }

  return null;
}

function extractFunctions(filePath, content) {
  if (/\.(py)$/i.test(filePath)) {
    return extractPythonFunctions(content);
  }

  return extractBraceFunctions(content);
}

function extractPythonFunctions(content) {
  const lines = content.split(/\r?\n/);
  const functions = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(\s*)(?:async\s+def|def)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const startLine = i + 1;
    let end = i;

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (!next.trim()) {
        end = j;
        continue;
      }

      const nextIndent = indentationOf(next);
      if (nextIndent <= indent && !next.trim().startsWith("#")) {
        break;
      }

      end = j;
    }

    functions.push({
      name: match[2],
      line: startLine,
      signature: line.trim(),
      lineCount: Math.max(1, end - i + 1),
      paramCount: countParams(match[3]),
    });
  }

  return functions;
}

function extractBraceFunctions(content) {
  const regexes = [
    /(?:^|\n)([ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{)/g,
    /(?:^|\n)([ \t]*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{)/g,
    /(?:^|\n)([ \t]*(?:public|private|protected|static|final|abstract|async|export|virtual|inline|constexpr|friend|\s)*[A-Za-z_$][\w$:<>\[\],*&\s]*\s+([A-Za-z_$][\w$]*)\s*\(([^;{}()]*)\)\s*\{)/g,
  ];

  const functions = [];
  for (const regex of regexes) {
    let match = regex.exec(content);
    while (match) {
      const signature = match[1].trim();
      const line = countLines(content.slice(0, match.index + (match[0].startsWith("\n") ? 1 : 0)));
      const openingBraceIndex = content.indexOf("{", match.index + match[0].length - 1);
      const closingBraceIndex = findMatchingBrace(content, openingBraceIndex);
      const endLine =
        closingBraceIndex >= 0 ? countLines(content.slice(0, closingBraceIndex + 1)) : line;

      functions.push({
        name: match[2],
        line,
        signature,
        lineCount: Math.max(1, endLine - line + 1),
        paramCount: countParams(match[3]),
      });

      match = regex.exec(content);
    }
  }

  return dedupeFunctions(functions);
}

function findMatchingBrace(content, openingBraceIndex) {
  if (openingBraceIndex < 0) {
    return -1;
  }

  let depth = 0;
  for (let i = openingBraceIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function dedupeFunctions(functions) {
  const seen = new Set();
  const deduped = [];

  for (const fn of functions) {
    const key = `${fn.line}:${fn.signature}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(fn);
  }

  return deduped.sort((a, b) => a.line - b.line);
}

function countParams(raw) {
  const cleaned = stripInlineComments(String(raw || "").trim());
  if (!cleaned) {
    return 0;
  }

  return cleaned
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "/" && item !== "*")
    .length;
}

function stripInlineComments(value) {
  return value.replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "").trim();
}

function countLines(text) {
  return text.split(/\r?\n/).length;
}

function indentationOf(line) {
  return (line.match(/^\s*/) || [""])[0].length;
}

module.exports = {
  matchCount,
};
