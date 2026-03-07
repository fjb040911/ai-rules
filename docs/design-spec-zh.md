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

## 安装（本地）
本仓库提供 Node.js CLI（位于 cli/）。

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

## 审计报告结构
审计 Prompt 要求输出 ai-rule-report.json，且每条违规必须包含 issueId 与 repairPrompt：
- issueId
- ruleId
- severity
- file, line
- description
- fixSuggestion
- repairPrompt

## 链接
- English design spec: [docs/design-spec-en.md](docs/design-spec-en.md)
- Repository overview: [rule.md](rule.md)
