function getReportSchemaText() {
  return '{ "version": "1.1", "generatedAt": "ISO-8601", "project": { "cwd": ".", "stack": "optional" }, "summary": { "total": 0, "fatal": 0, "warn": 0, "info": 0 }, "violations": [ { "issueId": "ISSUE-001", "ruleId": "RULE-001", "severity": "FATAL|WARN|INFO", "confidence": 0.0, "file": "src/...", "line": 1, "snippet": "...", "description": "...", "fixSuggestion": "...", "repairPrompt": "...", "evidence": { "source": "local-regex|local-import|ai-only", "matchedBy": "detect.regex|detect.import|detect.include|detect.ast|detect.semantic|unknown" }, "context": ["optional/path"] } ] }';
}

module.exports = {
  getReportSchemaText,
};
