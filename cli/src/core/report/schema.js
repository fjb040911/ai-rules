function getReportSchemaText() {
  return '{ "version": "1.1", "generatedAt": "ISO-8601", "project": { "cwd": ".", "stack": "optional" }, "summary": { "total": 0, "fatal": 0, "warn": 0, "info": 0 }, "violations": [ { "issueId": "ISSUE-001", "ruleId": "RULE-001", "severity": "FATAL|WARN|INFO", "confidence": 0.0, "file": "src/...", "line": 1, "snippet": "...", "description": "...", "fixSuggestion": "...", "repairPrompt": "...", "evidence": { "source": "local-regex|local-import|local-count|local-ast|ai-only", "matchedBy": "detect.regex|detect.import|detect.include|detect.count|detect.ast|detect.semantic|unknown", "strategy": "optional-detect-strategy", "confidence": 0.0, "evidenceId": "evidence:RULE-001", "evidenceIds": ["evidence:RULE-001", "evidence:RULE-001:match:1"] }, "context": ["optional/path"] } ] }';
}

function buildReportTemplate({ stack }) {
  return {
    version: "1.1",
    generatedAt: new Date().toISOString(),
    project: {
      cwd: ".",
      stack: stack || "unknown",
    },
    summary: {
      total: 0,
      fatal: 0,
      warn: 0,
      info: 0,
    },
    violations: [],
  };
}

module.exports = {
  getReportSchemaText,
  buildReportTemplate,
};
