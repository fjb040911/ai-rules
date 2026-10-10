<p align="center">
  <img src="assets/logo.svg" alt="AI-RULES 标志" width="720">
</p>

# AI-RULES

**把团队的工程约定，变成 AI 写代码、审查和修复时可引用的项目规则。**

AI-RULES 将架构与安全规范整理为可复用的规则、本地代码证据和聚焦的审查、修复提示词。规则随项目一起维护，供不同的 AI 编程工具使用。

可直接安装 Agent skill；可选 npm 包名和 CLI 命令均为 `ai-law`，CLI 需要 Node.js 18 或更高版本。采用 MIT 许可。

[English](README.md) | [简体中文](README.zh-CN.md)

## 在 Agent 聊天中使用（无需 Node.js）

仓库提供独立的 [`ai-rules` skill](skills/ai-rules/SKILL.md)。基础初始化、规则审查和修复使用 Agent 自带的文件工具，无需安装 Node.js 或 CLI。现有 `ai-law` 可选提供 AST 证据和确定性校验。

在支持 skill 安装的 Agent 中输入：

```text
帮我安装 https://github.com/fjb040911/ai-rules 中的 skills/ai-rules skill
```

安装位置和刷新方式由客户端决定；没有安装工具时，将完整 `skills/ai-rules` 目录放入客户端支持的 skill 目录。首次安装请提供仓库地址，仅输入名称不保证能够发现本项目。结构化表单也依赖客户端能力，不支持时使用聊天问答。

安装后，在目标项目中输入：

```text
使用 ai-rules 初始化
使用 ai-rules 自动初始化，采用推荐配置
使用 ai-rules 检查代码
使用 ai-rules 检查当前改动
使用 ai-rules 修复 ISSUE-001
```

初始化先检查已有 `.ai-rules/`，保留自定义规则和配置，再识别技术栈并适配真实目录。检查会阅读代码、输出 `ai-rule-report.json`，并在 `.ai-rules/cache/skill-review-coverage.json` 记录覆盖范围和限制；仅检查不会修改源码。基础模式的 Agent 一致性检查不等同于 CLI 严格校验。

技能资产包含 14 种模板的英文与简体中文版本，均已渲染并展开继承。维护者修改 `templates/` 后运行 `npm run build:skill` 更新资产；`npm pack` 也会自动构建。构建需要 Node.js，安装后的基础 skill 不需要。

## 为什么使用 AI-RULES

AI 生成的代码能够运行，却可能偏离项目约定：React 组件直接发起网络请求，Spring Controller 直接访问 Repository，驱动遗漏异常路径中的资源释放，模型流水线悄悄改变推理精度。

将这些约定写成项目规则，每次审查就有了明确依据。AI-RULES 编译规则，收集受支持的本地证据，生成包含规则编号、严重程度和报告结构的提示词。

| 你希望解决的问题 | AI-RULES 提供的能力 |
| --- | --- |
| 同一种问题需要在审查中反复解释 | 用版本管理维护 Markdown 规则，记录意图、要求和修复方向 |
| 模板目录与实际项目不一致 | 在 `config.json` 中配置路径别名，缺失路径会收到警告 |
| 发现问题后需要追溯代码依据 | 本地匹配包含文件位置和稳定的证据引用 |
| 审查结论难以转成具体修复任务 | 校验 JSON 报告，再按问题编号生成修复提示词 |
| 大项目一次审查占用过多上下文 | 选择上下文模式、限制证据规模，按规则或范围分批审查 |

从内置模板开始，调整目录映射，再加入团队在代码审查中已经使用的约定。

## 开始第一次审查

安装 CLI：

```bash
npm install -g ai-law
```

进入要审查的项目目录：

```bash
ai-law init
ai-law doctor
ai-law audit
```

`init` 让你选择语言和项目模板。审查前，打开 `.ai-rules/config.json`，将目录映射调整为项目的真实路径。`doctor` 检查配置、规则引用和已安装的 skills。

`audit` 输出生成的提示词，并尝试复制到剪贴板。将提示词交给 AI 编程工具，让它阅读代码、完成审查，将最终 JSON 保存为项目根目录下的 `ai-rule-report.json`。

报告生成后执行：

```bash
ai-law validate-report
ai-law fix --issueId ISSUE-001
```

将示例编号替换为报告中的实际问题编号。`fix` 生成修复提示词，由 AI 工具执行代码修改。检查改动，并运行项目测试。

<p align="center">
  <img src="assets/report.png" alt="结构化审查报告示例" width="880">
</p>

每个问题关联一条规则，并用稳定的问题编号衔接后续修复。

<p align="center">
  <img src="assets/fix.png" alt="针对单个问题生成的修复提示词示例" width="880">
</p>

修复提示词将选中的问题、规则要求和已有证据汇集到同一个任务中。

## 在 AI 编程工具中使用

生成可复用的工作流：

```bash
ai-law setup --provider claude-code --write
```

将 `claude-code` 替换为 `cursor`、`codex`、`copilot` 或 `custom`，即可生成对应的文件布局。

| 工作流 | 执行的 CLI 命令 | 报告 |
| --- | --- | --- |
| `law-audit` | `ai-law audit` | `ai-rule-report.json` |
| `law-fix` | `ai-law fix --issueId <ISSUE_ID>` | 使用架构审查报告 |
| `law-logic` | `ai-law inspect-logic --profile logic` | `ai-logic-report.json` |
| `law-native` | `ai-law inspect-logic --profile native` | `ai-native-report.json` |
| `law-model` | `ai-law inspect-logic --profile model` | `ai-model-report.json` |

客户端支持时，可调用生成的 `/law-*` 工作流。如果工具要求显式选择 skill，请选择对应项。通用工作流也可以手动执行。

| 工具类型 | 生成位置 |
| --- | --- |
| `claude-code` | `.claude/skills/law-*/SKILL.md` |
| `cursor` | `.cursor/skills/law-*/SKILL.md` |
| `codex` | `$CODEX_HOME/skills/law-*/SKILL.md`，默认位于 `~/.codex/skills/` |
| `copilot` | `.github/prompts/law-*.prompt.md` |
| `custom` | `.ai-rules/skills/law-*/SKILL.md` |

重新执行 `setup --write` 会更新工作流的托管内容，清理所选工具的旧命令文件，并在 `.ai-rules/cache/skill-manifest.json` 记录安装结果。`doctor` 会检查清单中的文件是否存在。

Claude Code 工作流通过动态注入读取 CLI 输出。安装时，会在 `.claude/settings.local.json` 的 `permissions.allow` 中加入 `Bash(ai-law:*)`。命令执行被拦截时，请检查客户端权限配置。

## 按技术栈选择模板

框架模板通过 `extends` 继承基础规则。你可以补充项目规则，并调整启用的规则集合。

| 项目类型 | 模板 | 代表性审查主题 |
| --- | --- | --- |
| 前端 | `frontend-base`、`react-js`、`react-ts`、`vue` | UI 与服务层边界、不安全 HTML、动态执行、Hooks、列表键、Vue props 和 computed 纯度 |
| 桌面应用与扩展 | `electron`、`vscode-extension` | 基于前端规则补充桌面应用和扩展宿主约定 |
| Node.js | `nodejs-base`、`express`、`nestjs` | 接入层、服务层与数据层分工，异步异常、敏感日志、外部调用超时 |
| Python 与 AI 模型 | `python-base`、`python-fastapi` | 异常处理、子进程边界、超时、输入输出契约、模型与检查点一致性 |
| Java | `java-base`、`java-spring` | 精简 Controller、输入校验、安全配置、事务边界、敏感日志 |
| C / C++ | `c-cpp` | 资源生命周期、关键返回值、锁顺序、DMA 生命周期、固件与协议校验 |

规则既包含可在本地匹配的模式，也包含供 AI 推理的约束。表中列出的主题不代表已实现完整的自动检测。

### 前端 AST 证据

部分 JS、TS、React 和 Vue 规则支持通过解析器收集本地证据，当前包括：

- UI 代码直接调用 `fetch()` 或 `axios.*`
- 使用 `innerHTML` 或 `dangerouslySetInnerHTML`
- 通过 `eval()` 或 `Function()` 动态执行代码
- React、Vue 列表使用循环索引作为键
- 在受支持的 `.vue` 脚本块中修改 props
- TS/TSX 文件使用 TypeScript `any`

当前版本尚未提供 Python、Java 和 C/C++ 的本地 AST 后端。未支持的 AST 检查继续交给 AI 审查，不会调用前端解析器。

## 审查业务逻辑、原生代码与模型流水线

按风险场景选择审查模式：

```bash
ai-law inspect-logic --profile logic
ai-law inspect-logic --profile native
ai-law inspect-logic --profile model
```

| 模式 | 审查重点 |
| --- | --- |
| `logic` | 授权、数据归属、状态流转、重放与幂等、多租户隔离、流程绕过 |
| `native` | 所有权与生命周期、关键返回值、锁协议、解析边界、特权操作、清理与回滚 |
| `model` | shape、dtype、device 契约，精度回退、检查点兼容性、训练与评估模式、分词和后处理一致性 |

不指定 `--profile` 时，C/C++ 默认使用 `native`，Python 模板默认使用 `model`，其他技术栈使用 `logic`。需要固定报告文件名时，请显式指定模式。

这些命令生成审查提示词和报告模板，由 AI 工具阅读源码并写入报告。logic、native、model 报告采用独立的 `risks` 结构；当前 `validate-report` 和 `fix` 处理的是 `ai-rule-report.json`。

## 控制审查上下文大小

`audit` 和 `inspect-logic` 默认采用 `balanced` 模式。选定审查范围内的规则会保留审查要求，没有本地匹配的规则也需要审查。证据按规则严重程度排序。

| 模式 | 初始规则细节 | 证据规则数 | 每条规则的匹配或候选数 | 片段或描述字符数 |
| --- | --- | --- | --- | --- |
| `compact` | 规则摘要 | 6 | 2 | 160 |
| `balanced` | 规则摘要；audit 展开有入选证据的规则 | 12 | 3 | 240 |
| `full` | 完整规则细节 | 默认不限 | 默认不限 | 默认不限 |

```bash
ai-law audit --context-mode compact
ai-law audit --rule ARCH-101 --context-mode full
ai-law audit --scope ui --max-evidence-rules 8 --max-matches-per-rule 2 --max-snippet-chars 180
ai-law inspect-logic --profile native --context-mode compact
```

`--rule` 精确匹配启用的规则编号，`--scope` 精确匹配规则范围名称，两者可以组合使用。需要进一步核查时，按单条规则生成 full 模式的提示词。

预算只影响提示词输出。`--json` 与缓存产物仍保留完整的已收集数据，供校验和修复使用。提示词会标明被省略的证据；省略匹配不代表代码安全。这些参数限制证据规模，不构成严格的 token 上限。

生成的 skills 优先使用提示词，按需读取源码或单条规则的详细证据。已有 skills 请通过 `setup --write` 更新。将完整缓存和提示词一起粘贴，会重复占用上下文。

## 将规则适配到你的项目

生成文件各有职责：

| 文件 | 职责 |
| --- | --- |
| `.ai-rules/.ai-rules.md` | 规则定义、意图、检测提示和修复方向 |
| `.ai-rules/rules-config.json` | 启用规则、范围、严重程度阈值、继承关系和扫描选项 |
| `.ai-rules/config.json` | 项目级覆盖配置，包括目录和解析器设置 |
| `.ai-rules/cache/` | 生成的上下文、证据、validator 输出和报告模板 |

本地 `config.json` 会覆盖合并后的规则配置。调整路径别名与 include、exclude 模式，使其对应实际需要审查的文件。

### 配置目录别名

目录划分较简单的项目，可以让多个别名指向同一个目录：

```json
{
  "pathAliases": {
    "@components": "src",
    "@services": "src",
    "@apiClient": "src"
  }
}
```

将所选模板使用的每个别名映射到真实目录。如果删除别名，请同时修改引用它的规则。配置路径不存在时，`doctor` 和 `audit` 会发出警告。

路径别名会在规则 `context` 和受支持的检测路径中解析。`context` 指向辅助阅读的文件或目录，不表示完整的审查范围。本地证据的收集范围由受支持的 `detect.where` 表达式及 include、exclude 模式确定。

### 编写项目规则

```md
### RULE: CUSTOM-101
severity: FATAL
scope: ui
intent: UI 组件应将网络请求放在服务层。
detect:
  regex: "fetch[(]|axios[.]"
  where: filePath in @components/**
fix: 将请求逻辑移入服务层。
prompt:
  violation: UI 层包含直接发起请求的逻辑。
  requirement: UI 组件必须通过服务层发起请求。
  solution: 在服务层复用共享客户端。
context:
  - @services
  - @apiClient
```

在 `rules-config.json` 中启用规则编号及其 scope，然后执行 `doctor`。为规则保留稳定编号，让审查报告和修复任务能引用同一条约定。

### 配置阈值与例外

```json
{
  "thresholds": {
    "maxFunctionLines": 80,
    "maxParamsCount": 5
  },
  "exceptions": {
    "ARCH-101": ["src/integrations/**"],
    "SEC-*": ["__mocks__/**", "**/*.stories.tsx"]
  }
}
```

已启用的计数规则可以引用这些阈值。例外配置会在受支持的本地证据检查中排除匹配文件。

### 配置前端解析器

```json
{
  "ast": {
    "provider": "babel",
    "target": "react",
    "useProjectConfig": true,
    "parserOptions": {
      "sourceType": "module",
      "plugins": ["jsx", "typescript"]
    }
  }
}
```

解析器设置依次合并模板默认值、检测到的项目配置（如 `tsconfig.json` 或 Babel 配置），最后应用本地覆盖值。解析器自身的配置继续放在原有项目文件中，AI-RULES 的覆盖项放入 `config.json`。

## 证据与报告的能力边界

| 检测类型 | 当前行为 |
| --- | --- |
| `regex` | 本地模式匹配 |
| `import` / `include` | 本地依赖或包含关系证据 |
| `count` | 本地 `function-lines` 和 `params-count` 证据 |
| 已支持的前端 `ast` 检查 | 解析器生成的本地证据 |
| `semantic` 和未支持的 `ast` 检查 | AI 辅助审查 |

CLI 在本地编译上下文、生成提示词，不会调用托管 AI 模型完成审查。项目上下文如何被处理，由你选择的 AI 工具决定。

本地证据是待核查的候选线索，AI 审查仍需阅读源码并进行跨文件推理。报告校验检查结构及可用的规则、证据引用，不证明某条漏洞结论成立。继续保留项目测试、lint、安全检测工具和人工代码审查。

`audit` 默认写入以下产物：

```text
.ai-rules/cache/audit-context.json
.ai-rules/cache/rule-ir.json
.ai-rules/cache/rule-validator.json
.ai-rules/cache/ai-rule-report.template.json
```

AI 生成的 `ai-rule-report.json` 使用 `1.1` 版本结构，包含项目摘要和 `violations` 数组。每条问题记录唯一的 `issueId`、规则编号、严重程度、位置、修复方向及可选证据引用。`validate-report` 会归一化兼容的旧格式，检查必填字段、重复编号，以及可用的规则与证据关系。

## CLI 命令参考

```bash
ai-law init
ai-law audit [--locale <code>] [--json] [--summary] [--dry-run] [--dump-context]
ai-law inspect-logic [--locale <code>] [--profile logic|native|model] [--json] [--dump-context]
ai-law fix --issueId <issue_id>
ai-law fix --id <rule_id>
ai-law fix --all [--group-by-rule]
ai-law doctor [--strict]
ai-law validate-report [--json] [--path <file>]
ai-law setup [--locale <code>] [--provider <name>] [--write]
ai-law -v
ai-law -h
```

`audit` 与 `inspect-logic` 的提示词选项：

```text
--context-mode compact|balanced|full
--rule <rule_id>
--scope <scope>
--max-evidence-rules <n>
--max-matches-per-rule <n>
--max-snippet-chars <n>
```

`audit --summary` 输出覆盖数量，`audit --dry-run` 输出本地与 AI 审查计划，`audit --json` 输出完整结构化上下文。`--dump-context` 显式重写缓存。`doctor --strict` 将警告视为失败。

## 语言支持

规则和提示词支持 `en`、`zh-CN`、`zh-TW`、`ja`、`ko`、`es`、`fr`。英文和简体中文语言文件较完整，其余语言为部分翻译，缺失内容自动回退到英文。

初始化时选择语言，或在生成提示词时指定 `--locale`。

## 规则编译器的演进方向

AI-RULES 将项目编写的 Markdown 规则编译为统一的 Rule IR、validator 决策、证据引用和修复提示。审查与修复工作流共用这套规则模型。

后续阶段见[版本演进路线](docs/version-evolution-plan.md)。当前 CLI 已能为 AI 工具生成这些产物，更广泛的执行与强制约束能力仍在路线规划中。

## 开发与设计文档

```bash
npm install
npm test
node cli/src/index.js --help
```

- [设计说明](design/design-spec-zh.md)
- [架构演进方向](docs/演进方向.md)
- [版本演进路线](docs/version-evolution-plan.md)
- [许可信息](package.json)
