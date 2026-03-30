# AI-RULES Design Specification (English)

## Overview

AI-RULES is a rule-aware CLI for AI-assisted coding governance. It converts project rules written in Markdown into structured rule metadata, lightweight local evidence, and deterministic audit/fix prompts so AI coding agents can follow architectural, design, and implementation constraints more consistently.

The current system is intentionally lightweight:

- the CLI parses and validates rule/config structure
- the CLI collects limited local evidence for supported rule types
- the AI still performs the final audit judgment
- the CLI normalizes the resulting report and generates stronger repair prompts

This keeps the tool useful today without pretending to be a full static analyzer.

## Goals

- Make project rules reusable across repositories
- Turn human-readable rule documents into machine-usable CLI context
- Improve audit prompt quality with local rule metadata and evidence
- Standardize audit report shape so downstream repair flows stay stable
- Reduce manual review cost in human-in-the-loop AI coding workflows

## Non-Goals

- Full AST or semantic rule execution inside the CLI
- Guaranteed sound or complete static analysis
- Automatic code modification by the CLI itself
- Replacing human review for high-risk changes

## Problem Statement

AI coding assistants often fail in predictable ways:

- they violate architecture boundaries
- they ignore project-specific conventions
- they produce inconsistent audit output schemas
- they lack enough local context to repair issues safely

Before the current iteration, AI-RULES mainly generated static prompts from templates. That was useful, but not enough. The newer design closes several gaps by adding:

- rule parsing
- config inheritance merge
- local evidence collection
- report normalization
- fix prompt enrichment from local rule metadata

## Product Positioning

AI-RULES should be understood as:

"A rule-aware orchestration CLI for AI coding audits and repairs."

It is not yet:

"A full local rules engine."

This distinction matters because the CLI now has real structure and validation, but the final audit still depends on AI reasoning for many higher-level constraints.

## High-Level Workflow

### 1. Initialize

`ai-law init`

- lets the user choose locale and template
- renders `.ai-rules/.ai-rules.md`
- renders `.ai-rules/rules-config.json`
- materializes `base/` for branch templates
- optionally writes prompt files for supported AI tools

### 2. Validate Local Setup

`ai-law doctor`

- checks `.ai-rules/` exists
- loads merged config through `extends`
- parses rules through `extends`
- validates rule IDs, scopes, required fields, and config consistency

### 3. Build Audit Context

`ai-law audit`

- loads merged config
- parses resolved rules
- validates local rule/config consistency
- collects lightweight local evidence
- assembles a rule-aware audit prompt

Optional outputs:

- `ai-law audit --json`
- `ai-law audit --dump-context`

### 4. Normalize Report

An AI tool produces `ai-rule-report.json`.

`ai-law validate-report`

- normalizes legacy or drifted report shapes
- validates required issue structure
- prints warnings/errors or normalized JSON

### 5. Generate Repair Prompt

`ai-law fix`

- reads and normalizes report data
- loads local rules
- combines report issues with local rule metadata
- outputs repair prompts for one issue, one rule, or all issues

## Project Layout

The CLI generates a project-local rules directory:

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

## Template Model

Templates are organized as base + branch:

- `frontend-base`
  - `react-ts`
  - `vue`
- `python-base`
  - `python-fastapi`
- `java-base`
  - `java-spring`
- `c-cpp`

Branch templates inherit from base templates through `extends`.

During `init`, branch templates materialize their base into `.ai-rules/base/` and point the branch outputs to those base files.

## Rule Document Model

Rules are stored in `.ai-rules.md` using `RULE` blocks.

Parsed fields currently include:

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
fix: Move request logic into the service layer.
prompt:
  violation: Direct network request found in UI code.
  requirement: UI code must not contain request logic.
  solution: Move request logic into services and reuse shared clients.
context:
  - src/services/
  - src/api/client.ts
```

## Configuration Model

Rules are paired with `rules-config.json`.

Key fields include:

- `enabledRuleIds`
- `severityThreshold`
- `scopes`
- `pathAliases`
- `detectOptions.include`
- `detectOptions.exclude`
- `prompt`
- `extends`

The CLI merges config through `extends` recursively.

Merge behavior:

- scalar fields: child overrides parent
- arrays: merged and deduplicated
- objects/maps: shallow merge, child wins on conflict

## Detection Model

### Supported for local evidence

- `detect.regex`
- `detect.import`
- `detect.include`

### AI-only for now

- `detect.ast`
- `detect.semantic`

This means AI-RULES can attach concrete file/line/snippet candidates for some rules, while still delegating more advanced reasoning to the AI model.

## Architecture

Current implementation is split into these layers:

### Template Layer

Location:

- `templates/`
- `templates/i18n/`

Responsibilities:

- provide stack-specific rule/config skeletons
- provide locale text
- support base + branch inheritance

### Config Layer

Location:

- `cli/src/core/config/`

Responsibilities:

- load `rules-config.json`
- resolve `extends`
- merge config trees

### Rule Layer

Location:

- `cli/src/core/rules/`

Responsibilities:

- parse `RULE` blocks
- resolve `extends` in rule documents
- validate parsed rules

### Evidence Layer

Location:

- `cli/src/core/evidence/`

Responsibilities:

- build candidate file sets from include/exclude globs
- collect regex matches
- collect import/include matches
- mark unsupported rule types as `ai-only`

### Prompt Layer

Location:

- `cli/src/core/prompt/`

Responsibilities:

- build rule-aware audit prompts
- include config summary
- include resolved rules
- include local evidence candidates
- include strict output schema

### Report Layer

Location:

- `cli/src/core/report/`

Responsibilities:

- normalize report shape
- summarize violations
- validate report structure
- support repair prompt generation

## Audit Context Format

`ai-law audit --json` outputs structured context with fields like:

- `version`
- `generatedAt`
- `locale`
- `config`
- `rules`
- `evidence`
- `findings`

This format is intended for:

- debugging prompt assembly
- future tool integrations
- deterministic inspection of the audit input state

## Audit Prompt Design

The generated audit prompt includes:

1. audit system instruction
2. audit user instruction
3. project config summary
4. resolved rules
5. local evidence candidates
6. strict report schema requirements

This is intentionally more deterministic than a single generic audit prompt.

## Report Schema

The normalized report shape is:

```json
{
  "version": "1.1",
  "generatedAt": "ISO-8601",
  "project": {},
  "summary": {
    "total": 0,
    "fatal": 0,
    "warn": 0,
    "info": 0
  },
  "violations": [
    {
      "issueId": "ISSUE-001",
      "ruleId": "RULE-001",
      "severity": "FATAL|WARN|INFO",
      "confidence": 0.0,
      "file": "src/...",
      "line": 1,
      "snippet": "...",
      "description": "...",
      "fixSuggestion": "...",
      "repairPrompt": "...",
      "evidence": {
        "source": "local-regex|local-import|ai-only",
        "matchedBy": "detect.regex|detect.import|detect.include|detect.ast|detect.semantic|unknown"
      },
      "context": ["optional/path"]
    }
  ]
}
```

Accepted legacy inputs may come from:

- top-level arrays
- `violations`
- `issues`
- `results`

The CLI normalizes these into one stable output form.

## Repair Prompt Design

`ai-law fix` now uses both:

- normalized report issues
- local rule metadata

When available, the generated repair prompt includes:

- rule severity
- rule scope
- rule intent
- rule requirement
- fix guidance
- context assets
- issue snippet
- issue evidence source
- repair prompt from report or a local fallback prompt

This makes the repair flow much less dependent on the raw AI report quality alone.

## Commands

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

## Validation Strategy

### Local setup validation

Handled by `doctor`:

- missing `.ai-rules`
- bad config inheritance
- bad rule inheritance
- duplicate rule IDs
- missing required rule fields
- invalid scopes
- missing enabled rules

### Report validation

Handled by `validate-report` and `fix`:

- missing `issueId`
- missing `ruleId`
- duplicate `issueId`
- invalid `severity`
- missing `repairPrompt` as warning

## Testing Strategy

Current tests cover:

- config merge through `extends`
- rule parsing through `extends`
- rule validation
- evidence collection
- audit prompt assembly
- report normalization

Tests run with:

```bash
npm test
```

## Known Limitations

- no full AST engine yet
- no semantic engine yet
- evidence collection is intentionally lightweight
- `where` expressions only support a limited subset of patterns today
- final audit quality still depends on the AI model being used

## Next Logical Evolution

Likely future work after the current design:

- richer local detection backends
- better `where` expression support
- tighter integration between audit context and validated report evidence
- machine-readable report pipelines across AI tools

## Links

- Design spec (中文): [docs/design-spec-zh.md](docs/design-spec-zh.md)
