# AI-RULES 技术设计白皮书（中文）

## 概述
AI-RULES 是面向 AI 编码的治理框架。它将自然语言规则（Markdown）转化为结构化约束与 Prompt，使 AI 生成的代码遵循既定架构、设计模式与 UI 规范。

## 解决的问题
- AI 生成代码容易越层、破坏架构边界。
- 规则难以在多项目复用且缺少统一入口。
- 审计流程依赖人工，难以规模化。

AI-RULES 提供可复用的规则模板与可执行的审计闭环：
- 规则一次定义，多项目复用
- CLI 生成审计与修复 Prompt
- 人机协作完成一致性检查

## 价值
- 架构级约束，提升 AI 生成质量
- 多模板体系，适配多语言与多框架
- 可复用的审计流程与报告结构
- 多语言 Prompt 渲染
AI-RULES 还能促使 AI 按既定规则自动 Review 代码，在 Human-in-the-Loop Audit Flow 中显著降低人工 Review 成本，在长周期任务中持续提升代码质量与一致性。

## 安装（本地）
本仓库提供 Node.js CLI（位于 cli/）。

若 npm 包暂未发布，可直接通过 GitHub 安装：

```bash
npm install -g ai-law
```

```bash
cd cli
npm install
npm link
```

之后可执行：
```bash
ai-law -h
```

## 快速开始
```bash
# 初始化规则
ai-law init

# 生成审计 Prompt（默认英文）
ai-law audit

# 指定中文语言包
ai-law audit --locale zh-CN

# 通过 issueId 获取修复 Prompt
ai-law fix --issueId ISSUE-001
```

## 项目规则目录
CLI 会在项目根目录创建 .ai-rules/：

```text
.ai-rules/
├── .ai-rules.md
├── rules-config.json
└── base/
    ├── .ai-rules.md
    └── rules-config.json
```

## 模板体系与继承
模板采用 base + branch 结构：
- frontend-base 及其 react-ts、vue 分支
- python-base 及其 python-fastapi 分支
- java-base 及其 java-spring 分支
- c-cpp 独立模板

选择分支模板时，CLI 会把 base 模板写入 .ai-rules/base/，并在主规则中使用 extends 继承。

## 多语言渲染
规则与 Prompt 使用 key 引用，语言包存放在 templates/i18n/。init 与 audit 会根据所选语言渲染为目标语言文本。

## 自定义与扩展规则
1. 修改 .ai-rules/.ai-rules.md 中的规则内容
2. 修改 .ai-rules/rules-config.json 中的规则启用与范围
3. 在 templates/i18n/ 中添加或修改语言文案
4. 使用 extends 复用 base 规则

### 规则扩展详细说明

#### 1) 规则块结构（.ai-rules.md）
每条规则建议使用统一结构，便于 CLI 与 AI 审计解析：

- RULE: 规则编号（示例：ARCH-101）
- severity: 严重级别（FATAL / WARN / INFO）
- scope: 规则作用域（如 architecture / api / security）
- intentKey: 规则意图文案 key
- detect: 检测条件（regex / ast / semantic）
- fixKey: 修复建议文案 key
- promptKeys: 审计 Prompt 片段 key（violation / requirement / solution）
- context: 项目可复用资产路径（供修复建议引用）

示例：

```markdown
### RULE: ARCH-101
severity: FATAL
scope: architecture
intentKey: rule.ARCH-101.intent

detect:
    regex: "@RestController[\\s\\S]*Repository"
    where: filePath in src/main/java/**
fixKey: rule.ARCH-101.fix
promptKeys:
    violation: rule.ARCH-101.prompt.violation
    requirement: rule.ARCH-101.prompt.requirement
    solution: rule.ARCH-101.prompt.solution
context:
    - src/main/java/**/service/
```

#### 2) 规则配置（rules-config.json）
新增规则后，必须同步配置文件：

- enabledRuleIds: 加入规则编号，否则不会参与审计
- scopes: 如果使用了新 scope，需加入 scopes 列表
- detectOptions.include/exclude: 确保规则覆盖目标代码路径
- prompt.promptTemplateKeys: 保持审计/修复模板 key 可解析

#### 3) 文案与多语言（templates/i18n/*.json）
所有规则文案都应通过 key 管理，不建议硬编码在规则文件：

至少新增以下 key：
- rule.<RULE_ID>.intent
- rule.<RULE_ID>.fix
- rule.<RULE_ID>.prompt.violation
- rule.<RULE_ID>.prompt.requirement
- rule.<RULE_ID>.prompt.solution

建议 zh-CN 与 en 同步维护，避免切换语言时出现缺失 key。

#### 4) 继承与分层扩展策略
- 通用约束放在 *-base（如 python-base、frontend-base）
- 框架专属约束放在分支模板（如 python-fastapi、react-ts）
- 分支模板通过 extends 继承 base，减少重复定义

实践建议：
- “跨项目都适用”的规则进 base
- “仅某框架适用”的规则进 branch

#### 5) 命名规范建议
- rule id 前缀按领域区分：ARCH、SEC、API、DATA、TEST、OBS
- 同一规则在多语言文案中使用同一 key 前缀
- issueId（审计报告）建议格式：ISSUE-001、ISSUE-002

#### 6) 检测策略建议
- 优先级：regex（快）→ ast（准）→ semantic（兜底）
- FATAL 规则尽量使用可确定的 detect 条件，减少误报
- 语义规则建议在报告中输出证据字段（如 file/line/snippet）

#### 7) 新增规则最小清单（Checklist）
新增一条规则时，至少完成以下 5 步：
1. 在 .ai-rules.md 中新增规则块（含 detect 与 promptKeys）
2. 在 rules-config.json 中启用该 ruleId
3. 在 zh-CN/en 语言包补齐文案 key
4. 用 ai-law audit 验证报告中是否输出该规则
5. 用 ai-law fix 验证是否能获取 repairPrompt

## 审计报告结构
审计 Prompt 要求输出 ai-rule-report.json，且每条违规必须包含 issueId 与 repairPrompt：
- issueId
- ruleId
- severity
- file, line
- description
- fixSuggestion
- repairPrompt

报告包含了违反的规则 ID、文件与行号位置、精准的 repairPrompt，并按违规级别分组。

## 链接
- English design spec: [docs/design-spec-en.md](docs/design-spec-en.md)
- Repository overview: [rule.md](rule.md)
