const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { parse: parseVueSfc } = require("@vue/compiler-sfc");
const { baseParse: parseVueTemplate } = require("@vue/compiler-dom");

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

  const documents = parseDocuments({ filePath, content, astConfig, strategy });
  const matches = [];

  for (const doc of documents) {
    if (!doc.ast) {
      continue;
    }

    if (doc.kind === "vue-template") {
      traverseVueTemplate(doc.ast, buildVueTemplateVisitors(strategy, doc, matches));
      continue;
    }

    traverse(doc.ast, buildVisitors(strategy, doc, matches, content));
  }

  return {
    supported: true,
    note: null,
    strategy: rule.detect && rule.detect.ast,
    confidence: inferConfidence(strategy),
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
    "frontend/no-direct-network-call": "no-direct-network-call",
    "react/no-index-key": "react-no-index-key",
    "typescript/no-any": "typescript-no-any",
    "vue/no-prop-mutation": "vue-no-prop-mutation",
    "vue/no-index-key": "vue-no-index-key",
    TSAnyKeyword: "typescript-no-any",
  };

  return lookup[normalized] || null;
}

function parseDocuments({ filePath, content, astConfig, strategy }) {
  if (filePath.endsWith(".vue")) {
    return parseVueDocuments({ filePath, content, astConfig, strategy });
  }

  return [parseScriptDocument({ filePath, content, astConfig, lineOffset: 0 })];
}

function parseVueDocuments({ filePath, content, astConfig, strategy }) {
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

  if (strategy === "vue-no-index-key" && parsed.descriptor.template && parsed.descriptor.template.content) {
    blocks.push(
      parseVueTemplateDocument({
        filePath,
        content: parsed.descriptor.template.content,
        lineOffset: Math.max(
          0,
          (parsed.descriptor.template.loc &&
            parsed.descriptor.template.loc.start &&
            parsed.descriptor.template.loc.start.line) ||
            1
        ),
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

function parseVueTemplateDocument({ filePath, content, lineOffset }) {
  try {
    const ast = parseVueTemplate(content, { comments: false });
    return { filePath, ast, lineOffset, content, kind: "vue-template" };
  } catch {
    return { filePath, ast: null, lineOffset, content, kind: "vue-template" };
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
    case "no-direct-network-call":
      return {
        CallExpression(path) {
          const callee = path.node.callee;
          if (isNetworkCall(callee)) {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, formatCallee(callee), doc.content);
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
    case "vue-no-prop-mutation":
      return {
        AssignmentExpression(path) {
          if (isPropsMutation(path.node.left)) {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "props mutation", doc.content);
          }
        },
        UpdateExpression(path) {
          if (isPropsMutation(path.node.argument)) {
            pushMatch(matches, doc, path.node.loc && path.node.loc.start.line, "props mutation", doc.content);
          }
        },
      };
    default:
      return {};
  }
}

function buildVueTemplateVisitors(strategy, doc, matches) {
  if (strategy !== "vue-no-index-key") {
    return {};
  }

  return {
    ElementNode(node) {
      const keyDirective = findVueKeyDirective(node);
      if (!keyDirective || !isVueIndexKey(keyDirective)) {
        return;
      }

      const localLine =
        (keyDirective.loc && keyDirective.loc.start && keyDirective.loc.start.line) ||
        (node.loc && node.loc.start && node.loc.start.line) ||
        1;
      pushMatch(matches, doc, localLine, "index-based key", doc.content);
    },
  };
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

function isNetworkCall(callee) {
  if (!callee) {
    return false;
  }
  if (callee.type === "Identifier") {
    return ["fetch", "axios", "ky", "request"].includes(callee.name);
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const objectName = callee.object && callee.object.type === "Identifier" ? callee.object.name : null;
    return ["axios", "ky", "request"].includes(objectName);
  }
  return false;
}

function formatCallee(callee) {
  if (!callee) {
    return "network call";
  }
  if (callee.type === "Identifier") {
    return `${callee.name}(...)`;
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const objectName = callee.object && callee.object.type === "Identifier" ? callee.object.name : "object";
    const propertyName =
      callee.property && callee.property.type === "Identifier" ? callee.property.name : "call";
    return `${objectName}.${propertyName}(...)`;
  }
  return "network call";
}

function isPropsMutation(node) {
  return (
    node &&
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object &&
    node.object.type === "Identifier" &&
    node.object.name === "props"
  );
}

function traverseVueTemplate(node, visitors) {
  if (!node || typeof node !== "object") {
    return;
  }

  const handler = visitors[node.typeName || inferVueNodeType(node)];
  if (typeof handler === "function") {
    handler(node);
  }

  for (const child of vueChildNodes(node)) {
    traverseVueTemplate(child, visitors);
  }
}

function inferVueNodeType(node) {
  if (node.type === 1) {
    return "ElementNode";
  }
  if (node.type === 0) {
    return "RootNode";
  }
  return `NodeType${node.type}`;
}

function vueChildNodes(node) {
  const children = [];

  if (Array.isArray(node.children)) {
    children.push(...node.children);
  }
  if (Array.isArray(node.branches)) {
    children.push(...node.branches);
  }
  if (Array.isArray(node.props)) {
    children.push(...node.props);
  }
  if (node.arg) {
    children.push(node.arg);
  }
  if (node.exp) {
    children.push(node.exp);
  }

  return children;
}

function findVueKeyDirective(node) {
  if (!node || !Array.isArray(node.props)) {
    return null;
  }

  return node.props.find((prop) => {
    if (prop.type !== 7 || !prop.arg) {
      return false;
    }
    return prop.arg.type === 4 && prop.arg.content === "key";
  });
}

function isVueIndexKey(directive) {
  if (!directive || !directive.exp || directive.exp.type !== 4) {
    return false;
  }
  const content = String(directive.exp.content || "").trim();
  return content === "index" || content === "i";
}

function inferConfidence(strategy) {
  if (strategy === "vue-no-index-key" || strategy === "react-no-index-key") {
    return 0.96;
  }
  if (
    strategy === "no-raw-html-injection" ||
    strategy === "no-dynamic-code-exec" ||
    strategy === "no-direct-network-call" ||
    strategy === "vue-no-prop-mutation" ||
    strategy === "typescript-no-any"
  ) {
    return 0.93;
  }
  return 0.9;
}

function pushMatch(matches, doc, localLine, label, sourceContent) {
  const line = (localLine || 1) + doc.lineOffset;
  matches.push({
    file: doc.filePath,
    line,
    snippet: readLine(sourceContent, localLine || 1),
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
