let clipboardy = null;
try {
  clipboardy = require("clipboardy");
} catch {
  clipboardy = null;
}

const writeClipboard = clipboardy
  ? (clipboardy.write && clipboardy.write.bind(clipboardy)) ||
    (clipboardy.default && clipboardy.default.write
      ? clipboardy.default.write.bind(clipboardy.default)
      : null)
  : null;

function writeOutput(prompt) {
  const separator = "==== AI-LAW PROMPT ====";
  process.stdout.write("\n");
  process.stdout.write(separator + "\n");
  process.stdout.write(prompt + "\n");
  process.stdout.write(separator + "\n");
  process.stdout.write("\n");
  if (!writeClipboard) {
    process.stderr.write("clipboardy.write is not available\n");
    return;
  }
  writeClipboard(prompt)
    .then(() => {
      process.stdout.write("Prompt copied to clipboard.\n");
      process.stdout.write("\x1b[1m\x1b[32m✅ Paste this prompt into your AI chat window \x1b[0m\n");
    })
    .catch((err) => {
      process.stderr.write(`Clipboard copy failed: ${String(err)}\n`);
    });
}

module.exports = { writeOutput };
