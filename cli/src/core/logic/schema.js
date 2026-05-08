function getLogicReportSchemaText() {
  return '{ "version": "1.0", "generatedAt": "ISO-8601", "project": { "cwd": ".", "stack": "optional" }, "summary": { "total": 0, "fatal": 0, "warn": 0, "info": 0 }, "risks": [ { "issueId": "LOGIC-001", "category": "authz|ownership|state-machine|idempotency|consistency|input-trust|tenant-isolation|workflow|resource-lifetime|error-propagation|concurrency-protocol|parser-boundary|privilege-boundary|cleanup-consistency", "ruleId": "optional-rule-id", "severity": "FATAL|WARN|INFO", "confidence": 0.0, "files": ["src/..."], "description": "...", "businessImpact": "...", "exploitPath": "...", "fixSuggestion": "...", "repairPrompt": "...", "evidence": { "evidenceIds": ["evidence:RULE-001", "evidence:RULE-001:match:1"] }, "context": ["optional/path"] } ] }';
}

function buildLogicReportTemplate({ stack }) {
  return {
    version: "1.0",
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
    risks: [],
  };
}

module.exports = {
  getLogicReportSchemaText,
  buildLogicReportTemplate,
};
