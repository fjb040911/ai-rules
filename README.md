# AI-RULES

AI-RULES is a rule-aware CLI for AI-assisted coding governance. It turns project rules in Markdown into structured rule metadata, lightweight local evidence, and deterministic audit/fix prompts so AI coding agents follow your architecture, design patterns, and UI standards more consistently.

## What It Does

- Initializes reusable rule templates for different stacks
- Parses `.ai-rules/.ai-rules.md` and `rules-config.json`
- Merges `extends` chains for rules and config
- Collects lightweight local evidence for `regex` and `import/include` style rules
- Supports config-level `thresholds` for future parameterized rule behavior
- Supports config-level `exceptions` to suppress known-safe files per rule pattern
- Generates rule-aware audit prompts instead of static prompt text
- Normalizes and validates `ai-rule-report.json`
- Generates stronger fix prompts using both the report and local rule metadata

## High-Value Built-In Coverage

Current templates already cover a first batch of high-priority engineering rules in addition to the original architecture baseline.

### Frontend / React / Vue

- UI code must not call network or data layers directly
- Raw HTML injection via `innerHTML` / `dangerouslySetInnerHTML` is flagged
- Semantic XSS flows from untrusted rich content into DOM sinks are called out
- Dynamic execution via `eval()` / `Function()` is flagged
- Hardcoded frontend secrets / API keys are flagged
- Third-party HTML script tags without SRI are flagged
- Hooks must follow React hook call rules
- React lists should not use array index as `key`
- React effect-driven remote requests should use stable dependency control
- Vue `computed` must stay pure
- Vue props must not be mutated directly
- Vue lists should not use loop index as `:key`
- Direct DOM access in Vue components is discouraged

### Python Base / FastAPI

- Bare `except` and broad swallowed exceptions are discouraged
- Mutable default arguments are flagged
- Weak password hashing algorithms such as MD5/SHA1 are flagged
- Logging patterns that may leak sensitive values are flagged
- External HTTP calls should define explicit timeouts
- FastAPI routes should not access repositories or DB sessions directly
- SQL built through interpolation/concatenation in FastAPI code is flagged
- FastAPI request logging must avoid tokens, cookies, auth headers, and raw credentials
- FastAPI endpoints should use Pydantic input models
- FastAPI endpoints should declare explicit `response_model`
- List-style FastAPI endpoints should enforce pagination or limit bounds
- Async paths should avoid blocking HTTP clients and `time.sleep`

### Java / Spring

- Controllers should not depend on repositories directly
- Controllers should stay thin and avoid business branching/orchestration
- `@Valid` should guard `@RequestBody` inputs
- Overly permissive CORS is flagged
- Exception handlers that may leak stack traces are flagged
- Logging patterns that may expose credentials are flagged
- Sensitive Spring endpoints should have explicit authn/authz coverage
- Overly permissive Spring Security config such as broad `permitAll()` or global protection disablement is flagged
- Write paths should define transaction boundaries
- `@Transactional` should not live on controllers
- Write-oriented service logic should keep explicit transaction semantics

## Current Scope

AI-RULES is not a full static analysis engine yet.

- `regex` and `import/include` detection can collect local evidence
- `ast` and `semantic` rules are still AI-guided and treated as `ai-only`
- The CLI helps structure context and outputs, while the AI still makes the final audit decision

## Installation

Requires Node.js `>=18`.

Install globally:

```bash
npm install -g ai-law
```

Or for local development in this repository:

```bash
npm install
npm test
```

## Quick Start

```bash
cd your-project

# 1. Initialize rules in the current project
ai-law init

# 2. Check that rules/config are valid
ai-law doctor

# 3. Generate a rule-aware audit prompt
ai-law audit

# 4. Or inspect the structured audit context directly
ai-law audit --json

# 5. Save audit context for debugging/integration
ai-law audit --dump-context

# 6. After your AI tool produces ai-rule-report.json, validate it
ai-law validate-report

# 7. Generate a fix prompt for one issue
ai-law fix --issueId ISSUE-001

# 8. Or generate a grouped fix prompt for the whole report
ai-law fix --all --group-by-rule
```

## Workflow

### 1. Initialize

`ai-law init` creates a `.ai-rules/` directory in your project and materializes the selected template.

Example layout:

```text
.ai-rules/
├── .ai-rules.md
├── rules-config.json
├── base/
│   ├── .ai-rules.md
│   └── rules-config.json
└── cache/
    └── audit-context.json
```

### 2. Validate Local Rule Setup

`ai-law doctor` validates:

- `.ai-rules/` exists
- `rules-config.json` can be loaded and merged through `extends`
- the rules file can be parsed
- `enabledRuleIds` point to real rules
- rule scopes match config scopes
- required rule fields exist

Use `ai-law doctor --strict` to treat warnings as failures.

### 3. Generate Audit Context

`ai-law audit` now reads the current project rules and builds a prompt from:

- merged config
- parsed rules
- enabled rule IDs
- local evidence candidates
- strict report schema requirements

Useful variants:

```bash
ai-law audit --locale zh-CN
ai-law audit --json
ai-law audit --dump-context
```

`--json` prints the structured audit context instead of a prompt.

`--dump-context` writes `.ai-rules/cache/audit-context.json`.

### 4. Validate The AI Report

After your AI tool returns `ai-rule-report.json`, run:

```bash
ai-law validate-report
```

This command normalizes legacy or drifted report shapes into a stable structure and checks for issues like:

- missing `issueId`
- missing `ruleId`
- duplicate `issueId`
- invalid `severity`

You can inspect the normalized report with:

```bash
ai-law validate-report --json
```

### 5. Generate Fix Prompts

`ai-law fix` now combines:

- normalized report data
- local rule metadata from `.ai-rules`
- rule intent / requirement / fix guidance
- context assets
- report evidence and snippets when present

Examples:

```bash
ai-law fix --issueId ISSUE-001
ai-law fix --id ARCH-101
ai-law fix --all
ai-law fix --all --group-by-rule
```

## Rule Model

Rules are defined in `.ai-rules.md` using `RULE` blocks. The CLI currently parses fields such as:

- `RULE`
- `severity`
- `scope`
- `intent`
- `fix`
- `detect`
- `prompt`
- `context`
- `extends`

Example:

```md
### RULE: ARCH-101
severity: FATAL
scope: ui
intent: UI components must not initiate network requests directly.

detect:
  regex: "fetch\\(|axios\\."
  where: filePath in src/components/**
fix: Move request logic into a service layer.
prompt:
  violation: Detected direct request logic in UI layer.
  requirement: UI components must not contain request logic.
  solution: Move requests to a service and reuse shared clients.
context:
  - src/services/
  - src/api/client.ts
```

## Detection Support

Current support in the CLI:

- `detect.regex`: local evidence collection supported
- `detect.import`: local evidence collection supported
- `detect.include`: local evidence collection supported
- `detect.ast`: AI-only for now
- `detect.semantic`: AI-only for now

This means the CLI can attach concrete local evidence for some rules, while still allowing AI-guided review for higher-level semantic constraints.

The current templates intentionally mix:

- fast local rules for obvious anti-patterns
- semantic AI-guided rules for higher-level architectural or transactional reasoning

## Config Extensions

The config model now supports two roadmap-oriented extensions:

### `thresholds`

Used for configurable numeric limits that future rules can reference.

Example:

```json
{
  "thresholds": {
    "maxFunctionLines": 80,
    "maxParamsCount": 5,
    "maxListLimit": 100
  }
}
```

### `exceptions`

Used to suppress known-safe files for matching rule IDs or rule ID patterns during local evidence collection.

Example:

```json
{
  "exceptions": {
    "ARCH-101": [
      "src/integrations/**"
    ],
    "SEC-*": [
      "__mocks__/**",
      "**/*.stories.tsx"
    ]
  }
}
```

These exceptions currently affect local evidence collection for supported local detect modes.

## Report Shape

The audit prompt requests strict JSON with a normalized structure like:

```json
{
  "version": "1.1",
  "generatedAt": "2026-03-30T12:00:00Z",
  "project": {
    "cwd": ".",
    "stack": "react-ts"
  },
  "summary": {
    "total": 1,
    "fatal": 0,
    "warn": 1,
    "info": 0
  },
  "violations": [
    {
      "issueId": "ISSUE-001",
      "ruleId": "ARCH-101",
      "severity": "WARN",
      "confidence": 0.82,
      "file": "src/pages/Home.tsx",
      "line": 12,
      "snippet": "const data = fetch('/api')",
      "description": "Direct network request found in UI layer.",
      "fixSuggestion": "Move request logic into services.",
      "repairPrompt": "Provide a minimal patch...",
      "evidence": {
        "source": "local-regex",
        "matchedBy": "detect.regex"
      },
      "context": [
        "src/services/"
      ]
    }
  ]
}
```

## Templates

Current templates:

- `frontend-base`
  - `react-ts`
  - `vue`
- `python-base`
  - `python-fastapi`
- `java-base`
  - `java-spring`
- `c-cpp`

Branch templates inherit from base templates through `extends`.

## CLI Commands

```bash
ai-law init
ai-law audit [--locale <code>] [--json] [--dump-context]
ai-law fix --issueId <issue_id>
ai-law fix --id <rule_id>
ai-law fix --all [--group-by-rule]
ai-law doctor [--strict]
ai-law validate-report [--json] [--path <file>]
ai-law setup [--locale <code>] [--provider <name>] [--write]
ai-law -v
ai-law -h
```

## Development Notes

Current implementation layers:

- `cli/src/core/config`: config loading and `extends` merge
- `cli/src/core/rules`: rule parsing and validation
- `cli/src/core/evidence`: local evidence collection
- `cli/src/core/prompt`: audit prompt assembly
- `cli/src/core/report`: report normalization and schema

Run tests:

```bash
npm test
```

## Docs

- English design spec: [docs/design-spec-en.md](docs/design-spec-en.md)
- 中文设计文档: [docs/design-spec-zh.md](docs/design-spec-zh.md)
