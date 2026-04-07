function resolveRulePaths(rules, config) {
  const aliases = (config && config.pathAliases) || {};
  return rules.map((rule) => resolveRule(rule, aliases));
}

function resolveRule(rule, aliases) {
  const next = {
    ...rule,
    detect: {
      ...(rule.detect || {}),
    },
  };

  next.context = (rule.context || []).map((entry) => resolvePathAlias(entry, aliases));

  if (next.detect.where) {
    next.detect.where = resolveWhere(next.detect.where, aliases);
  }

  if (next.detect.import) {
    next.detect.import = resolvePathAlias(next.detect.import, aliases);
  }

  if (next.detect.include) {
    next.detect.include = resolvePathAlias(next.detect.include, aliases);
  }

  return next;
}

function resolveWhere(where, aliases) {
  return where.replace(/(filePath|importer|includer) in (.+)$/u, (match, field, pattern) => {
    return `${field} in ${resolvePathAlias(pattern.trim(), aliases)}`;
  });
}

function resolvePathAlias(value, aliases) {
  if (typeof value !== "string") {
    return value;
  }

  for (const [alias, target] of Object.entries(aliases)) {
    if (value === alias) {
      return target;
    }
    if (value.startsWith(`${alias}/`)) {
      return joinAliasTarget(target, value.slice(alias.length + 1));
    }
  }

  return value;
}

function joinAliasTarget(target, suffix) {
  if (!suffix) {
    return target;
  }
  return `${String(target).replace(/\/+$/u, "")}/${suffix.replace(/^\/+/u, "")}`;
}

module.exports = {
  resolveRulePaths,
};
