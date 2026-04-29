const path = require("path");
const { loadConfig } = require("../config/load-config");
const { resolveAstConfig } = require("../config/resolve-ast-config");
const { parseRules } = require("./parse-rules");
const { resolveRulePaths } = require("./resolve-rules");
const { compileRulesToIR } = require("./compile-rule-ir");

async function loadRuleContext({ cwd, configPath }) {
  const resolvedConfigPath = configPath || path.join(cwd, ".ai-rules", "rules-config.json");
  const config = await loadConfig(resolvedConfigPath);
  config.resolvedAstConfig = await resolveAstConfig({ cwd, config });

  const rulesFile = config.rulesFile || ".ai-rules.md";
  const rulesPath = path.resolve(path.dirname(resolvedConfigPath), rulesFile);
  const rules = resolveRulePaths(await parseRules(rulesPath), config);
  const ruleIR = compileRulesToIR({ config, rules });

  return {
    configPath: resolvedConfigPath,
    rulesPath,
    config,
    rules,
    ruleIR,
  };
}

module.exports = {
  loadRuleContext,
};
