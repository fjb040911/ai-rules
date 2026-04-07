# Show HN: AI-RULES, project-local rules for AI coding agents

I built a small CLI called **AI-RULES** to solve a problem I kept running into while using AI coding agents:

AI agents are increasingly good at producing plausible code, but they often miss repository-specific rules.

They may:

- call APIs directly from UI components
- put business logic into controllers
- bypass service/repository boundaries
- forget transaction boundaries
- log tokens or passwords
- return audit reports in inconsistent shapes
- ignore non-standard project directory layouts

These are usually not syntax problems. They are project-governance problems.

AI-RULES tries to give coding agents a project-local rule contract before code reaches review, CI, or merge gates.

Repository:

```text
https://github.com/fjb040911/ai-rules
```

## What it does

AI-RULES generates a local `.ai-rules/` directory:

```text
.ai-rules/
├── .ai-rules.md
├── rules-config.json
├── config.json
└── cache/
    └── audit-context.json
```

The files have separate responsibilities:

- `.ai-rules.md`: the actual rules
- `rules-config.json`: enabled rules, severity thresholds, scan options, exceptions
- `config.json`: project-specific path aliases such as `@controller`, `@service`, `@api`, `@components`
- `audit-context.json`: optional structured context emitted by `audit --dump-context`

The goal is not to ask an AI to "please follow our conventions" in a vague way. The goal is to give it a structured local protocol:

- which rules are enabled
- which paths matter
- how to resolve repository-specific directories
- which exceptions are allowed
- what output schema to return
- how to generate focused repair prompts

## Example rule

A Spring rule can look like this:

```md
### RULE: JAVA-ARCH-101
severity: FATAL
scope: architecture
intent: Controllers must not depend on repositories directly.

detect:
  regex: "@RestController[\\s\\S]*@Autowired[\\s\\S]*Repository"
  where: filePath in @mainJava/**
fix: Move business/data access logic into service layer.
context:
  - @service
```

The path aliases are not hardcoded in the rule. They live in `config.json`:

```json
{
  "pathAliases": {
    "@mainJava": "src/main/java",
    "@controller": "src/main/java/**/controller",
    "@service": "src/main/java/**/service",
    "@repository": "src/main/java/**/repository"
  }
}
```

If a repository uses a different layout, users can edit `config.json` instead of rewriting every rule.

## CLI flow

Install:

```bash
npm install -g ai-law
```

Initialize rules in a project:

```bash
ai-law init
```

Validate local config:

```bash
ai-law doctor
```

Generate an audit prompt:

```bash
ai-law audit
```

Inspect structured audit context:

```bash
ai-law audit --json
```

Dump context for integration/debugging:

```bash
ai-law audit --dump-context
```

Validate an AI-produced report:

```bash
ai-law validate-report
```

Generate a repair prompt:

```bash
ai-law fix --issueId ISSUE-001
```

Or group all fixes:

```bash
ai-law fix --all --group-by-rule
```

## Path alias warnings

One problem with reusable rules is that real repositories do not all use the same layout.

AI-RULES now warns when a configured alias points to a path that does not exist:

```text
========== AI-RULES WARNING ==========
IMPORTANT: pathAliases.@controller points to 'src/main/java/**/controller',
but 'src/main/java' was not found. Open .ai-rules/config.json and update this alias for your project layout.
========================================
```

This is meant to make rule setup less magical. If the directory mapping is wrong, users should see it before relying on the generated audit prompt.

## Built-in templates

Current templates include:

- frontend base
- React + TypeScript
- Vue + TypeScript
- Python base
- Python + FastAPI
- Java base
- Java + Spring
- C/C++

Some examples of built-in coverage:

- UI components should not call network/data layers directly
- React lists should not use array index keys
- Vue props should not be mutated directly
- FastAPI routes should not access repositories or DB sessions directly
- FastAPI endpoints should declare `response_model`
- list endpoints should enforce pagination or limit bounds
- SQL string interpolation/concatenation is flagged
- sensitive logging patterns are flagged
- Spring controllers should stay thin
- write paths should define transaction boundaries
- overly permissive CORS / security config is flagged
- exception handlers should not leak stack traces

## What it is not

AI-RULES is not a full static analyzer.

Right now:

- `regex` rules can collect local evidence
- `import/include` rules can collect local evidence
- `ast` rules are still AI-guided
- `semantic` rules are still AI-guided

The CLI does not claim to prove correctness. It structures rule context, gathers lightweight evidence where possible, and asks the AI to make the final judgment for higher-level rules.

This is intentional. I wanted the tool to be useful now, without pretending to be a complete static analysis engine.

## How it differs from repository governance tools

Tools like Harness are useful for repository governance:

- branch rules
- push rules
- tag rules
- CODEOWNERS
- reviewers
- merge restrictions
- secret scanning

AI-RULES sits earlier in the workflow.

It is about AI coding behavior, not repository merge policy.

One way to frame it:

> Harness governs the repository boundary.
> AI-RULES governs the AI coding behavior before code reaches that boundary.

They are complementary, not replacements.

## Why I built it

The more I use AI coding agents, the more I think the next bottleneck is not code generation itself.

The bottleneck is getting AI-generated code to follow local engineering rules:

- architecture boundaries
- service layering
- security defaults
- directory conventions
- repair output schemas

AI-RULES is my attempt to make those rules explicit, local, reusable, and easy for different AI coding tools to consume.

Feedback is very welcome, especially around:

- rule format
- template coverage
- false-positive handling
- evidence collection
- future AST support
