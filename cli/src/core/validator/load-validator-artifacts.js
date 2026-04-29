const path = require("path");
const fs = require("fs/promises");
const { readJson } = require("../../utils/fs");

async function loadValidatorArtifacts({ cwd }) {
  const availableEvidenceIds = new Set();
  const availableRuleIds = new Set();
  const validatorEvidenceById = new Map();

  const contextPath = path.join(cwd, ".ai-rules", "cache", "audit-context.json");
  if (await fileExists(contextPath)) {
    try {
      const context = await readJson(contextPath);
      for (const entry of context.evidence || []) {
        if (entry && typeof entry.evidenceId === "string") {
          availableEvidenceIds.add(entry.evidenceId);
        }
        for (const match of entry.matches || []) {
          if (match && typeof match.matchId === "string") {
            availableEvidenceIds.add(match.matchId);
          }
        }
      }
    } catch {
      // Best-effort helper for validator/report linking.
    }
  }

  const validatorPath = path.join(cwd, ".ai-rules", "cache", "rule-validator.json");
  if (await fileExists(validatorPath)) {
    try {
      const artifact = await readJson(validatorPath);
      const validator = artifact && artifact.validator ? artifact.validator : null;

      for (const result of (validator && validator.results) || []) {
        if (result && typeof result.ruleId === "string") {
          availableRuleIds.add(result.ruleId);
        }
      }

      for (const violation of (validator && validator.violations) || []) {
        if (violation && typeof violation.ruleId === "string") {
          availableRuleIds.add(violation.ruleId);
        }
        for (const evidenceId of extractEvidenceIds(violation)) {
          availableEvidenceIds.add(evidenceId);
          if (!validatorEvidenceById.has(evidenceId)) {
            validatorEvidenceById.set(evidenceId, {
              ruleId: violation.ruleId || null,
              issueId: violation.issueId || null,
            });
          }
        }
      }
    } catch {
      // Best-effort helper for validator/report linking.
    }
  }

  return {
    availableEvidenceIds: availableEvidenceIds.size > 0 ? availableEvidenceIds : null,
    availableRuleIds: availableRuleIds.size > 0 ? availableRuleIds : null,
    validatorEvidenceById: validatorEvidenceById.size > 0 ? validatorEvidenceById : null,
  };
}

function extractEvidenceIds(violation) {
  const values = [];
  if (!violation || !violation.evidence) {
    return values;
  }

  if (typeof violation.evidence.evidenceId === "string" && violation.evidence.evidenceId.trim()) {
    values.push(violation.evidence.evidenceId);
  }

  for (const entry of violation.evidence.evidenceIds || []) {
    if (typeof entry === "string" && entry.trim() && !values.includes(entry)) {
      values.push(entry);
    }
  }

  return values;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  loadValidatorArtifacts,
};
