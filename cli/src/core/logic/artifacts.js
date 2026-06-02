function getLogicArtifactNames(profile) {
  if (profile === "native") {
    return {
      contextFile: "native-audit-context.json",
      templateFile: "ai-native-report.template.json",
      outputFile: "ai-native-report.json",
    };
  }
  if (profile === "model") {
    return {
      contextFile: "model-audit-context.json",
      templateFile: "ai-model-report.template.json",
      outputFile: "ai-model-report.json",
    };
  }
  return {
    contextFile: "logic-audit-context.json",
    templateFile: "ai-logic-report.template.json",
    outputFile: "ai-logic-report.json",
  };
}

module.exports = {
  getLogicArtifactNames,
};
