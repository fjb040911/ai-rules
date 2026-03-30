const REQUIRED_RULE_FIELDS = ["id", "severity", "scope", "intent", "fix"];
const REQUIRED_PROMPT_FIELDS = ["violation", "requirement", "solution"];
const VALID_SEVERITIES = new Set(["FATAL", "WARN", "INFO"]);

function validateRules({ rules, config }) {
  const findings = [];
  const ruleIds = new Set();
  const configScopes = new Set(config.scopes || []);
  const enabledRuleIds = new Set(config.enabledRuleIds || []);

  for (const rule of rules) {
    if (ruleIds.has(rule.id)) {
      findings.push(error(`Duplicate ruleId '${rule.id}'.`));
    } else {
      ruleIds.add(rule.id);
    }

    for (const field of REQUIRED_RULE_FIELDS) {
      if (!rule[field]) {
        findings.push(error(`Rule '${rule.id || "UNKNOWN"}' is missing required field '${field}'.`));
      }
    }

    if (rule.severity && !VALID_SEVERITIES.has(rule.severity)) {
      findings.push(error(`Rule '${rule.id}' has invalid severity '${rule.severity}'.`));
    }

    if (rule.scope && configScopes.size > 0 && !configScopes.has(rule.scope)) {
      findings.push(error(`Rule '${rule.id}' uses scope '${rule.scope}' that is not declared in rules-config.json.`));
    }

    if (!rule.detect || Object.keys(rule.detect).length === 0) {
      findings.push(error(`Rule '${rule.id}' must declare a detect block.`));
    }

    for (const promptField of REQUIRED_PROMPT_FIELDS) {
      if (!rule.prompt || !rule.prompt[promptField]) {
        findings.push(error(`Rule '${rule.id}' is missing prompt.${promptField}.`));
      }
    }

    if (!enabledRuleIds.has(rule.id)) {
      findings.push(warn(`Rule '${rule.id}' is defined but not enabled in rules-config.json.`));
    }
  }

  for (const ruleId of enabledRuleIds) {
    if (!ruleIds.has(ruleId)) {
      findings.push(error(`enabledRuleIds references missing rule '${ruleId}'.`));
    }
  }

  return findings;
}

function error(message) {
  return { level: "error", message };
}

function warn(message) {
  return { level: "warn", message };
}

module.exports = {
  validateRules,
};
