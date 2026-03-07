# AI-RULES Design Specification (English)

## Overview
AI-RULES is a governance framework for AI-assisted coding. It turns human-readable rules in Markdown into structured constraints and prompts, so AI agents follow your architecture, design patterns, and UI standards.

## What Problems It Solves
- AI-generated code often violates architectural boundaries (e.g., UI calling data layers directly).
- Teams repeat rules across projects without a consistent enforcement workflow.
- Audits are manual, inconsistent, and hard to reproduce.

AI-RULES provides a repeatable flow:
- Define rules once
- Use CLI to generate audit and repair prompts
- Enforce structure consistently across projects

## Core Value
- Architecture-safe AI output
- Reusable rule templates per stack
- Human-in-the-loop audit flow
- Multi-language prompt rendering

## Installation (Local)
This repository ships a Node.js CLI under cli/.

```bash
cd cli
npm install
npm link
```

Then you can run:
```bash
ai-law -h
```

## Quick Start
```bash
# Initialize rules in a project
ai-law init

# Generate audit prompt (default locale: en)
ai-law audit

# Generate audit prompt in Chinese
ai-law audit --locale zh-CN

# Copy fix prompt from report
ai-law fix --issueId ISSUE-001
```

## Project Rules Directory
The CLI generates a .ai-rules/ folder in your project root:

```text
.ai-rules/
├── .ai-rules.md
├── rules-config.json
└── base/
    ├── .ai-rules.md
    └── rules-config.json
```

## Templates and Inheritance
Templates are organized as base + branch:
- frontend-base with react-ts and vue branches
- python-base with python-fastapi branch
- java-base with java-spring branch
- c-cpp standalone

Branch templates extend base templates. The CLI materializes base rules into .ai-rules/base/ when you select a branch.

## Multi-Language Rules
All descriptions and prompts are key-based and rendered from templates/i18n/. The init and audit flows select a locale and render the final prompts accordingly.

## Customizing Rules
1. Edit .ai-rules/.ai-rules.md for rule content.
2. Edit .ai-rules/rules-config.json for scope, enabled rules, and prompt templates.
3. Add or modify keys in templates/i18n/ for localized text.
4. Use extends to reuse base rules.

## Audit Report Schema
The audit prompt requests ai-rule-report.json with per-violation issueId and repairPrompt. Example fields:
- issueId
- ruleId
- severity
- file, line
- description
- fixSuggestion
- repairPrompt

## Links
- Design spec (中文): [docs/design-spec-zh.md](docs/design-spec-zh.md)
- Repository overview: [rule.md](rule.md)
