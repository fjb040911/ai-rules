# Architecture report version 1.1

Write project-root ai-rule-report.json:

```json
{
  "version": "1.1",
  "generatedAt": "2026-01-01T00:00:00Z",
  "project": { "cwd": ".", "stack": "react-ts" },
  "summary": { "total": 0, "fatal": 0, "warn": 0, "info": 0 },
  "violations": []
}
```

Use the actual generation time. Each violation has unique issueId (e.g. ISSUE-001), enabled ruleId, severity (FATAL/WARN/INFO), confidence (number 0..1), file (project-relative), line (positive actual line number), snippet, description, fixSuggestion, and repairPrompt. Optional context contains relevant project-relative paths. Counts must exactly match violations.

For basic agent review omit optional evidence, or use source: ai-only and matchedBy: detect.semantic/unknown with confidence. Never fabricate evidenceId/evidenceIds. When the CLI actually produced evidence, use its real identifiers and supported source (local-regex/local-import/local-count/local-ast), matchedBy, and strategy. An evidence reference is a candidate link, not proof that the finding is correct.

Keep uncertainty and coverage in the separate coverage artifact rather than changing the report version or inventing required fields. Business-logic/native/model reviews have separate existing CLI report contracts; don't write their risks arrays into this architecture violations format. This skill's initial workflow is project-rule review.

Check JSON structure, unique IDs, required fields, positive line numbers, confidence bounds, enabled rule references, and matching summary counts. CLI validation is optional but preferred when already available; agent inspection is not equivalent to deterministic validation.
