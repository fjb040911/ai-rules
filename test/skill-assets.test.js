const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { parseRules } = require('../cli/src/core/rules/parse-rules');
const { loadConfig } = require('../cli/src/core/config/load-config');
const { validateRules } = require('../cli/src/core/rules/validate-rules');
const { buildTemplateChoices, getTemplatesRoot } = require('../cli/src/utils/templates');
const root = path.resolve(__dirname, '../skills/ai-rules/assets/templates');

test('every standalone template installs without source templates and retains inherited rule selection', async () => {
  const index = JSON.parse(await fs.readFile(path.join(root, 'index.json')));
  const choices = await buildTemplateChoices(getTemplatesRoot());
  assert.equal(index.templates.length, choices.length);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-rules-skill-'));
  try {
    for (const locale of index.locales) {
      for (const { value } of choices) {
        const source = value.branchDir || value.templateDir;
        const name = path.basename(source);
        const installed = path.join(temporary, locale, name, '.ai-rules');
        await fs.cp(path.join(root, locale, name), installed, { recursive: true });
        const config = await loadConfig(path.join(installed, 'rules-config.json'));
        const rules = await parseRules(path.join(installed, '.ai-rules.md'));
        const original = await loadConfig(path.join(source, 'rules-config.json'));
        assert.deepEqual(config.enabledRuleIds, original.enabledRuleIds, name);
        assert.deepEqual(rules.map(rule => rule.id), (await parseRules(path.join(source, '.ai-rules.md'))).map(rule => rule.id), name);
        assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length, name);
        assert.deepEqual(validateRules({ rules, config }).filter(item => item.level === 'error'), [], name);
        assert.ok(rules.every(rule => rule.intent && rule.fix && rule.prompt.requirement), name);
        assert.equal(config.i18n.defaultLocale, locale);
        assert.equal(config.extends, undefined);
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
