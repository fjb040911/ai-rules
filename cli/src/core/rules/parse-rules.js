const fs = require("fs/promises");
const path = require("path");

async function parseRules(filePath) {
  return parseRulesInternal(path.resolve(filePath), new Set());
}

async function parseRulesInternal(filePath, seen) {
  if (seen.has(filePath)) {
    throw new Error(`Circular rule extends detected: ${filePath}`);
  }

  seen.add(filePath);
  const content = await fs.readFile(filePath, "utf8");
  const document = parseRulesContent(content);

  let inheritedRules = [];
  if (document.extendsPath) {
    const parentPath = path.resolve(path.dirname(filePath), document.extendsPath);
    inheritedRules = await parseRulesInternal(parentPath, seen);
  }

  seen.delete(filePath);
  return inheritedRules.concat(document.rules);
}

function parseRulesContent(content) {
  const lines = content.split(/\r?\n/);
  const rules = [];
  let extendsPath = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!extendsPath && trimmed.startsWith("extends:")) {
      extendsPath = valueOf(trimmed);
      i += 1;
      continue;
    }

    if (!trimmed.startsWith("### RULE:")) {
      i += 1;
      continue;
    }

    const block = [line];
    i += 1;
    while (i < lines.length && !lines[i].trim().startsWith("### RULE:")) {
      block.push(lines[i]);
      i += 1;
    }
    rules.push(parseRuleBlock(block));
  }

  return { extendsPath, rules };
}

function parseRuleBlock(lines) {
  const idLine = lines[0].trim();
  const rule = {
    id: idLine.replace("### RULE:", "").trim(),
    context: [],
    prompt: {},
    detect: {},
  };

  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed === "---") {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("severity:")) {
      rule.severity = valueOf(trimmed);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("scope:")) {
      rule.scope = valueOf(trimmed);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("intent:")) {
      rule.intent = valueOf(trimmed);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("fix:")) {
      rule.fix = valueOf(trimmed);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("detect:")) {
      const parsed = parseIndentedMap(lines, i + 1, indentationOf(line));
      rule.detect = parsed.value;
      i = parsed.nextIndex;
      continue;
    }

    if (trimmed.startsWith("prompt:")) {
      const parsed = parseIndentedMap(lines, i + 1, indentationOf(line));
      rule.prompt = parsed.value;
      i = parsed.nextIndex;
      continue;
    }

    if (trimmed.startsWith("context:")) {
      const parsed = parseList(lines, i + 1, indentationOf(line));
      rule.context = parsed.value;
      i = parsed.nextIndex;
      continue;
    }

    i += 1;
  }

  rule.detectKind = firstKey(rule.detect);
  return rule;
}

function parseIndentedMap(lines, startIndex, parentIndent) {
  const value = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = indentationOf(line);

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (indent <= parentIndent) {
      break;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex < 0) {
      i += 1;
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    value[key] = stripQuotes(rawValue);
    i += 1;
  }

  return { value, nextIndex: i };
}

function parseList(lines, startIndex, parentIndent) {
  const value = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = indentationOf(line);

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (indent <= parentIndent) {
      break;
    }

    if (trimmed.startsWith("- ")) {
      value.push(stripQuotes(trimmed.slice(2).trim()));
    }
    i += 1;
  }

  return { value, nextIndex: i };
}

function valueOf(trimmedLine) {
  return stripQuotes(trimmedLine.split(":").slice(1).join(":").trim());
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function indentationOf(line) {
  return (line.match(/^\s*/) || [""])[0].length;
}

function firstKey(object) {
  const keys = Object.keys(object || {});
  return keys.length > 0 ? keys[0] : null;
}

module.exports = {
  parseRules,
  parseRulesContent,
};
