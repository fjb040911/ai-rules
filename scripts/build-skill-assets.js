// Release-time generation only; installed skills do not execute this script.
const fs = require('fs/promises');
const path = require('path');
const { buildTemplateChoices, getTemplatesRoot, readLocaleMap, renderRulesMarkdown, renderConfigJson, renderLocalConfigJson } = require('../cli/src/utils/templates');
const { mergeConfigs } = require('../cli/src/core/config/load-config');
const root = path.resolve(__dirname, '..', 'skills', 'ai-rules', 'assets', 'templates');
async function build() {
  const choices = await buildTemplateChoices(getTemplatesRoot());
  const index = [];
  for (const locale of ['en', 'zh-CN']) {
    const map = await readLocaleMap(locale);
    for (const { value } of choices) {
      const dirs = value.type === 'branch' ? [value.baseDir, value.branchDir] : [value.templateDir];
      const name = path.basename(dirs[dirs.length - 1]);
      let config = {};
      let rules = '';
      for (const dir of dirs) {
        const rendered = await renderRulesMarkdown(path.join(dir, '.ai-rules.md'), map);
        const body = rendered.slice(rendered.indexOf('### RULE:'));
        if (!rendered.includes('### RULE:')) throw new Error(`No rules in ${dir}`);
        rules += body + '\n';
        let layer = await renderConfigJson(path.join(dir, 'rules-config.json'), map);
        layer = mergeConfigs(layer, await renderLocalConfigJson(path.join(dir, 'config.json')));
        config = mergeConfigs(config, layer);
      }
      config.i18n = { defaultLocale: locale };
      delete config.extends;
      config.rulesFile = '.ai-rules.md';
      const target = path.join(root, locale, name);
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, '.ai-rules.md'), `# AI-RULES ${name}\n\nversion: ${config.version}\nstack: ${name}\n\n${rules}`);
      await fs.writeFile(path.join(target, 'rules-config.json'), JSON.stringify(config, null, 2) + '\n');
      await fs.writeFile(path.join(target, 'config.json'), '{}\n');
      if (locale === 'en') index.push(name);
    }
  }
  await fs.writeFile(path.join(root, 'index.json'), JSON.stringify({ locales: ['en', 'zh-CN'], templates: index.sort() }, null, 2) + '\n');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
