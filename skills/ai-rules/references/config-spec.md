# Project rule contract

Files:
- .ai-rules/.ai-rules.md defines rules in sections headed `### RULE: ID`, with severity (FATAL/WARN/INFO), scope, intent, detect, fix, prompt (violation/requirement/solution), and context paths.
- .ai-rules/rules-config.json selects rules and configures scanning.
- .ai-rules/config.json supplies local overrides.

Resolve config extends relative to the declaring config file. At each inheritance level merge the parent, the current rules-config, then sibling config.json. Detect cycles and missing references; do not proceed as if configuration were valid. Scalar values use the child value. enabledRuleIds, scopes, detectOptions.include/exclude, ast.parserOptions.plugins, and each exceptions map entry use stable deduplicated parent-then-child union. Empty child arrays do not disable parent entries. pathAliases, thresholds, i18n, prompt templates, and parser option objects merge by key, child wins. Delete extends from the effective configuration.

Resolve Markdown extends relative to the declaring rule file and load parent rules first. The existing CLI concatenates parent and child rules; duplicate IDs are invalid, not overrides. Reject duplicate IDs across inheritance as well. Resolve rulesFile relative to the root rules-config file. Reject ambiguous duplicate IDs within one file. Preserve user-selected enablement rather than enabling every defined rule.

Path aliases such as @services resolve by exact alias or alias + slash prefix. Project paths are relative to project root. Apply configured include/exclude patterns and exceptions (including wildcard rule IDs), selected rule IDs, scopes, and severity threshold. Severity order is FATAL, WARN, INFO. Rule context paths are supporting reading material, not the full scan scope. Honor detect.where restrictions when evaluating a rule; unsupported expressions must be disclosed, not ignored.

Rules may specify regex, import/include, count, ast, or semantic detection. These are candidate-finding strategies; review requirements and source context decide a violation. Without the CLI, do not emulate its parser with misleading claims of equivalence. Read intent and prompt requirements even when no search match exists.

Bundled assets are generated at release time from repository templates. They contain rendered text and flattened inheritance, so installed users do not need a renderer or locale files.
