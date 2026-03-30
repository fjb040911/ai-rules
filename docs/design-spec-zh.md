# AI-RULES 技术设计白皮书（中文）

## 概述

AI-RULES 是一个面向 AI 编码治理的 rule-aware CLI。它将项目中的 Markdown 规则转化为结构化规则元数据、轻量本地证据以及更确定性的 audit/fix Prompt，让 AI 编码代理更稳定地遵循既定架构、设计模式与实现约束。

当前版本的设计思路是“轻量编排”而不是“重型规则引擎”：

- CLI 负责解析和校验规则与配置
- CLI 负责为部分规则收集本地证据
- AI 仍然承担最终审计判断
- CLI 负责标准化审计报告并生成更强的修复 Prompt

这样既能立即产生价值，也不会虚假承诺完整静态分析能力。

## 目标

- 让规则在多项目之间可复用
- 将自然语言规则转化为 CLI 可消费的结构化上下文
- 通过本地规则与证据提升 audit Prompt 质量
- 统一审计报告结构，降低 repair 流程漂移
- 在 Human-in-the-Loop 的 AI 编码流程中降低人工 Review 成本

## 非目标

- 在 CLI 内实现完整 AST / 语义规则执行器
- 提供完备或严格正确的静态分析结果
- 由 CLI 直接自动改代码
- 替代高风险变更中的人工审查

## 问题定义

AI 编码助手常见的问题主要有：

- 越层调用，破坏架构边界
- 忽略项目特定规范
- 审计输出格式不稳定
- 缺乏足够本地上下文，导致修复建议不安全

早期 AI-RULES 更偏向“模板化 Prompt 生成器”。当前版本则在此基础上补上了：

- 规则解析
- 配置继承合并
- 本地证据收集
- 报告标准化
- 基于本地规则元数据的修复 Prompt 增强

## 产品定位

AI-RULES 当前更准确的定位是：

“面向 AI 编码审计与修复流程的规则编排 CLI”

而不是：

“完整本地规则执行器”

这个定位很重要，因为现在 CLI 已经具备了真实的结构化能力，但对于更高阶的 AST/语义判断，仍然依赖 AI 模型本身。

## 高层工作流

### 1. 初始化

`ai-law init`

- 让用户选择语言和模板
- 渲染 `.ai-rules/.ai-rules.md`
- 渲染 `.ai-rules/rules-config.json`
- 对分支模板物化 `base/`
- 可选地为支持的 AI 工具写入 prompt/slash 文件

### 2. 校验本地规则设置

`ai-law doctor`

- 检查 `.ai-rules/` 是否存在
- 通过 `extends` 加载并合并配置
- 通过 `extends` 解析规则文件
- 校验 rule id、scope、必填字段与配置一致性

### 3. 构建审计上下文

`ai-law audit`

- 加载合并后的配置
- 解析规则
- 做本地规则/配置一致性校验
- 收集轻量本地证据
- 组装 rule-aware 的 audit Prompt

可选输出：

- `ai-law audit --json`
- `ai-law audit --dump-context`

### 4. 标准化审计报告

AI 工具生成 `ai-rule-report.json` 后，执行：

`ai-law validate-report`

- 兼容历史或漂移的报告形态
- 归一化为稳定结构
- 输出错误/警告或标准化后的 JSON

### 5. 生成修复 Prompt

`ai-law fix`

- 读取并标准化报告
- 加载本地规则元数据
- 将 issue 与本地规则上下文拼接
- 输出单 issue、单 rule 或整份报告的修复 Prompt

## 项目规则目录

CLI 会在项目根目录创建：

```text
.ai-rules/
├── .ai-rules.md
├── rules-config.json
├── base/
│   ├── .ai-rules.md
│   └── rules-config.json
└── cache/
    └── audit-context.json
```

## 模板体系

模板采用 base + branch 结构：

- `frontend-base`
  - `react-ts`
  - `vue`
- `python-base`
  - `python-fastapi`
- `java-base`
  - `java-spring`
- `c-cpp`

分支模板通过 `extends` 继承 base。

在 `init` 阶段，分支模板会将基座物化到 `.ai-rules/base/`，主规则与主配置再指向这些 base 文件。

## 规则文档模型

规则写在 `.ai-rules.md` 中，使用 `RULE` block 表达。

当前 CLI 可解析字段包括：

- `RULE`
- `severity`
- `scope`
- `intent`
- `fix`
- `detect`
- `prompt`
- `context`
- `extends`

示例：

```md
### RULE: ARCH-101
severity: FATAL
scope: ui
intent: UI 组件不得直接发起网络请求。

detect:
  regex: "fetch\\(|axios\\."
  where: filePath in src/components/**
fix: 将请求逻辑下沉到 service 层。
prompt:
  violation: 检测到 UI 层直接发起请求。
  requirement: UI 层禁止包含请求逻辑。
  solution: 将请求迁移到 service 并复用共享客户端。
context:
  - src/services/
  - src/api/client.ts
```

## 配置模型

规则与 `rules-config.json` 配套使用。

关键字段包括：

- `enabledRuleIds`
- `severityThreshold`
- `scopes`
- `pathAliases`
- `detectOptions.include`
- `detectOptions.exclude`
- `prompt`
- `extends`

CLI 会递归处理 `extends` 并输出合并后的配置。

合并策略：

- 标量字段：子配置覆盖父配置
- 数组字段：去重合并
- map/object：浅合并，子配置优先

## 检测模型

### 当前支持本地证据收集

- `detect.regex`
- `detect.import`
- `detect.include`

### 当前仍交给 AI 判断

- `detect.ast`
- `detect.semantic`

这意味着部分规则可以附带明确的文件/行号/snippet 候选证据，而更复杂的结构化判断仍交由 AI 处理。

## 系统分层

当前实现大致分为以下几层：

### 模板层

位置：

- `templates/`
- `templates/i18n/`

职责：

- 提供不同技术栈的规则模板
- 提供多语言文案
- 支持 base + branch 继承

### 配置层

位置：

- `cli/src/core/config/`

职责：

- 加载 `rules-config.json`
- 解析 `extends`
- 合并配置树

### 规则层

位置：

- `cli/src/core/rules/`

职责：

- 解析 `RULE` block
- 解析规则文件中的 `extends`
- 校验规则结构

### 证据层

位置：

- `cli/src/core/evidence/`

职责：

- 根据 include/exclude 构建候选文件集
- 收集 regex 命中
- 收集 import/include 命中
- 将暂不支持本地执行的规则标记为 `ai-only`

### Prompt 组装层

位置：

- `cli/src/core/prompt/`

职责：

- 构建 rule-aware 的 audit Prompt
- 注入配置摘要
- 注入解析后的规则
- 注入本地证据候选
- 注入严格输出 schema

### 报告层

位置：

- `cli/src/core/report/`

职责：

- 标准化报告结构
- 汇总 summary
- 校验报告字段
- 为修复 Prompt 提供稳定输入

## 审计上下文格式

`ai-law audit --json` 输出结构化上下文，主要字段包括：

- `version`
- `generatedAt`
- `locale`
- `config`
- `rules`
- `evidence`
- `findings`

它主要用于：

- 调试 Prompt 组装过程
- 未来与外部工具对接
- 稳定查看 audit 输入状态

## Audit Prompt 设计

生成的 audit Prompt 由以下部分组成：

1. audit system 指令
2. audit user 指令
3. 项目配置摘要
4. 已解析规则列表
5. 本地证据候选
6. 严格报告 schema

相比单条固定 Prompt，这种结构更可控、更可解释。

## 报告结构

标准化后的报告结构为：

```json
{
  "version": "1.1",
  "generatedAt": "ISO-8601",
  "project": {},
  "summary": {
    "total": 0,
    "fatal": 0,
    "warn": 0,
    "info": 0
  },
  "violations": [
    {
      "issueId": "ISSUE-001",
      "ruleId": "RULE-001",
      "severity": "FATAL|WARN|INFO",
      "confidence": 0.0,
      "file": "src/...",
      "line": 1,
      "snippet": "...",
      "description": "...",
      "fixSuggestion": "...",
      "repairPrompt": "...",
      "evidence": {
        "source": "local-regex|local-import|ai-only",
        "matchedBy": "detect.regex|detect.import|detect.include|detect.ast|detect.semantic|unknown"
      },
      "context": ["optional/path"]
    }
  ]
}
```

兼容的历史输入形式包括：

- 顶层数组
- `violations`
- `issues`
- `results`

CLI 会先把这些输入标准化，再向下游传递。

## Repair Prompt 设计

`ai-law fix` 当前不再只依赖原始报告文本，而是同时使用：

- 标准化后的 issue 数据
- 本地规则元数据

当本地规则存在时，修复 Prompt 可携带：

- rule severity
- rule scope
- rule intent
- rule requirement
- fix guidance
- context assets
- issue snippet
- issue evidence source
- 报告自带 repairPrompt 或本地生成的 fallback prompt

这使 repair 流程对原始 AI 报告质量的依赖降低了很多。

## CLI 命令

```bash
ai-law init
ai-law audit [--locale <code>] [--json] [--dump-context]
ai-law fix --issueId <issue_id>
ai-law fix --id <rule_id>
ai-law fix --all [--group-by-rule]
ai-law doctor [--strict]
ai-law validate-report [--json] [--path <file>]
ai-law setup [--locale <code>] [--provider <name>] [--write]
ai-law -v
ai-law -h
```

## 校验策略

### 本地规则设置校验

由 `doctor` 负责：

- 缺少 `.ai-rules`
- 配置继承错误
- 规则继承错误
- 重复 ruleId
- 缺失必填规则字段
- 非法 scope
- `enabledRuleIds` 指向不存在规则

### 报告校验

由 `validate-report` 与 `fix` 负责：

- 缺失 `issueId`
- 缺失 `ruleId`
- 重复 `issueId`
- 非法 `severity`
- 缺失 `repairPrompt` 作为 warning

## 测试策略

当前已覆盖：

- 配置继承合并
- 规则继承解析
- 规则校验
- 本地证据收集
- audit Prompt 组装
- 报告标准化

运行方式：

```bash
npm test
```

## 已知限制

- 还没有完整 AST 引擎
- 还没有完整语义分析引擎
- 本地证据收集有意保持轻量
- `where` 表达式目前只支持有限子集
- 最终审计质量仍依赖所使用的 AI 模型

## 下一步可能演进

基于当前设计，后续自然演进方向包括：

- 更丰富的本地检测后端
- 更强的 `where` 表达式支持
- audit context 与 validated report evidence 的更紧密联动
- 面向不同 AI 工具的机器可消费报告流水线

## 链接

- English design spec: [docs/design-spec-en.md](docs/design-spec-en.md)
