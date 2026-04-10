const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { parse: parseVueSfc } = require("@vue/compiler-sfc");

async function matchAst({ rule, filePath, content, astConfig }) {
  if (!astConfig || !astConfig.provider) {
    return {
      supported: false,
      note: "No local AST backend is configured for this project type yet, so this AST rule still requires AI judgment.",
      matches: [],
    };
  }

  const strategy = resolveAstStrategy(rule);
  if (!strategy) {
    return {
      supported: false,
      note: "This AST rule is not supported by the current local AST backend yet and still requires AI judgment.",
      matches: [],
    };
  }

  if (!supportsFileForAst(filePath)) {
    return {
      supported: false,
      note: `Local AST analysis currently only supports frontend JS/TS/Vue files. '${filePath}' will remain AI-guided.`,
      matches: [],
    };
  }

  const documents = parseDocuments({ filePath, content, astConfig });
  const matches = [];

  for (const doc of documents) {
    if (!doc.ast) {
      continue;
    }

    traverse(doc.ast, buildVisitors(strategy, doc, matches, content));
  }

  return {
    supported: true,
    note: null,
    matches,
  };
}

function resolveAstStrategy(rule) {
  const ast = rule.detect && rule.detect.ast;
  if (!ast) {
    return null;
  }

  const normalized = String(ast).trim();
  const lookup = {
    "frontend/no-raw-html-injection": "no-raw-html-injection",
    "frontend/no-dynamic-code-exec": "no-dynamic-code-exec",
    "react/no-index-key": "react-no-index-key",
    "typescript/no-any": "typescript-no-any",
    TSAnyKeyword: "typescript-no-any",
  };

  return lookup[normalized] || null;
}

function parseDocuments({ filePath, content, astConfig }) {
  if (filePath.endsWith(".vue")) {
    return parseVueDocuments({ filePath, content, astConfig });
  }

  return [parseScriptDocument({ filePath, content, astConfig, lineOffset: 0 })];
}

function parseVueDocuments({ filePath, content, astConfig }) {
  const parsed = parseVueSfc(content, { filename: filePath });
  const blocks = [];

  for (const block of [parsed.descriptor.script, parsed.descriptor.scriptSetup]) {
    if (!block || !block.content) {
      continue;
    }

    blocks.push(
      parseScriptDocument({
        filePath,
        content: block.content,
        astConfig,
        lineOffset: Math.max(0, (block.loc && block.loc.start && block.loc.start.line) || 1),
      })
    );
  }

  return blocks;
}

function parseScriptDocument({ filePath, content, astConfig, lineOffset }) {
  const parserOptions = buildParserOptions(filePath, astConfig);
  try {
    const ast = babelParser.parse(content, parserOptions);
    return { filePath, ast, lineOffset, content };
  } catch {
    return { filePath, ast: null, lineOffset, content };
  }
}

function buildParserOptions(filePath, astConfig) {
  const parserOptions = (astConfig && astConfig.parserOptions) || {};
  const plugins = new Set(parserOptions.plugins || []);

  if (/\.(jsx|tsx|vue)$/i.test(filePath)) {
    plugins.add("jsx");
  }
  if (/\.(ts|tsx)$/i.test(filePath)) {
    plugins.add("typescript");
  }

  return {
    sourceType: parserOptions.sourceType || "module",
    plugins: Array.from(plugins),
    errorRecovery: true,
  };
}

function buildVisitors(strategy, doc, matches, sourceContent) {
  switch (strategy) {
    case "no-raw-html-injection":
      return {
        JSXAttribute(path) {
          if (
            path.node.name &&
            path.node.name.name === "dangerouslySetInnerHTML"
          ) {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "dangerouslySetInnerHTML", sourceContent);
          }
        },
        AssignmentExpression(path) {
          if (isInnerHtmlAssignment(path.node.left)) {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "innerHTML assignment", sourceContent);
          }
        },
      };
    case "no-dynamic-code-exec":
      return {
        CallExpression(path) {
          if (path.node.callee && path.node.callee.name === "eval") {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "eval(...)", doc.content);
          } else if (path.node.callee && path.node.callee.name === "Function") {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "Function(...)", doc.content);
          }
        },
        NewExpression(path) {
          if (path.node.callee && path.node.callee.name === "Function") {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "new Function(...)", doc.content);
          }
        },
      };
    case "react-no-index-key":
      return {
        JSXAttribute(path) {
          if (!path.node.name || path.node.name.name !== "key") {
            return;
          }
          if (isIndexKeyAttribute(path.node.value)) {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "index-based key", sourceContent);
          }
        },
      };
    case "typescript-no-any":
      return {
        TSAnyKeyword(path) {
          pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "any type", sourceContent);
        },
      };
    default:
      return {};
  }
}

function isInnerHtmlAssignment(left) {
  return (
    left &&
    left.type === "MemberExpression" &&
    !left.computed &&
    left.property &&
    left.property.type === "Identifier" &&
    left.property.name === "innerHTML"
  );
}

function isIndexKeyAttribute(value) {
  if (!value) {
    return false;
  }
  if (value.type === "JSXExpressionContainer") {
    const expr = value.expression;
    return expr && expr.type === "Identifier" && (expr.name === "index" || expr.name === "i");
  }
  return false;
}

function pushMatch(matches, doc, localLine, label, sourceContent) {
  const line = (localLine || 1) + doc.lineOffset;
  matches.push({
    file: doc.filePath,
    line,
    snippet: readLine(sourceContent, line),
    label,
  });
}

function readLine(content, lineNumber) {
  const lines = String(content || "").split(/\r?\n/);
  return lines[Math.max(0, lineNumber - 1)] || "";
}

module.exports = {
  matchAst,
  resolveAstStrategy,
};

function supportsFileForAst(filePath) {
  return /\.(js|jsx|ts|tsx|vue)$/i.test(filePath);
}
