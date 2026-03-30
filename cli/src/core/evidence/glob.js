function globToRegExp(glob) {
  const expanded = expandBraces(glob);
  const patterns = expanded.map((item) => `(?:${convertSingleGlob(item)})`);
  return new RegExp(`^(?:${patterns.join("|")})$`);
}

function matchesGlob(value, glob) {
  return globToRegExp(normalizeGlob(glob)).test(normalizePath(value));
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function normalizeGlob(glob) {
  return normalizePath(glob).replace(/^\.\//, "");
}

function convertSingleGlob(glob) {
  let output = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];

    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          output += "(?:.*/)?";
          i += 2;
        } else {
          output += ".*";
          i += 1;
        }
      } else {
        output += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      output += ".";
      continue;
    }

    if (char === "/") {
      output += "/";
      continue;
    }

    output += escapeRegExp(char);
  }

  return output;
}

function expandBraces(glob) {
  const match = glob.match(/\{([^{}]+)\}/);
  if (!match) {
    return [glob];
  }

  const before = glob.slice(0, match.index);
  const after = glob.slice(match.index + match[0].length);
  const parts = match[1].split(",");
  const expanded = [];

  for (const part of parts) {
    for (const suffix of expandBraces(after)) {
      expanded.push(`${before}${part}${suffix}`);
    }
  }

  return expanded;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

module.exports = {
  matchesGlob,
  normalizePath,
};
