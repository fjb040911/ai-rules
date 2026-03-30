const path = require("path");
const fs = require("fs/promises");
const { readJson } = require("./utils/fs");
const { normalizeReport } = require("./core/report/normalize");

async function runValidateReport(argv) {
  const cwd = process.cwd();
  const reportPath = parsePathArg(argv) || path.join(cwd, "ai-rule-report.json");
  const outputJson = argv.includes("--json");
  const exists = await fileExists(reportPath);

  if (!exists) {
    process.stderr.write(`Report not found: ${reportPath}\n`);
    process.exitCode = 1;
    return;
  }

  let rawReport;
  try {
    rawReport = await readJson(reportPath);
  } catch (err) {
    process.stderr.write(`Failed to read report: ${String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const normalized = normalizeReport(rawReport);

  if (outputJson) {
    process.stdout.write(JSON.stringify(normalized.report, null, 2) + "\n");
  } else {
    process.stdout.write("AI-LAW validate-report\n\n");
    for (const finding of normalized.findings) {
      const prefix = finding.level === "error" ? "ERROR" : "WARN";
      process.stdout.write(`[${prefix}] ${finding.message}\n`);
    }
    process.stdout.write(
      `Summary: ${normalized.report.summary.total} issue(s), ${normalized.findings.filter((item) => item.level === "error").length} error(s), ${normalized.findings.filter((item) => item.level === "warn").length} warning(s)\n`
    );
  }

  if (normalized.findings.some((item) => item.level === "error")) {
    process.exitCode = 1;
  }
}

function parsePathArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--path") {
      return argv[i + 1];
    }
  }
  return null;
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
  runValidateReport,
};
