# 我做了一个让 AI 更懂项目规则的 CLI：AI-RULES

最近这段时间，我一直在思考一个问题：

AI 编程工具越来越强，但为什么在真实项目里，用起来还是经常“不放心”？

它能写代码、能改 bug、能生成测试，但也很容易犯一些团队里反复强调过的错误：

- 前端组件里直接调用 API 或数据层
- 后端 Controller 里塞业务逻辑
- Service 写操作没有事务边界
- 日志里打印 token、password、Authorization
- FastAPI 接口缺少 `response_model`
- 列表接口没有分页上限
- AI 审计结果格式不稳定，后续修复很难继续自动化

这些问题不是 AI 不聪明，而是它经常缺少“项目级规则上下文”。

所以我做了一个 CLI 工具：**AI-RULES**。

它的目标不是取代 AI 编程工具，而是给 Codex、Cursor、Claude Code 这类 AI coding agent 提供一套项目本地的规则协议，让 AI 在写代码、审计代码、修复代码之前，先理解团队约束。

项目地址：

```text
https://github.com/fjb040911/ai-rules
```

## AI-RULES 解决什么问题？

一句话概括：

**让 AI 在代码进入 Review、CI、合并门禁之前，就尽量按照你的项目规则写代码。**

很多治理工具关注的是“代码提交之后”的事情，比如 PR 能不能合并、分支保护、reviewer 数量、secret scanning、CODEOWNERS 等。

这些当然很重要。

但 AI-RULES 关注的是更前置的一步：

**AI 正在生成代码时，它是否知道你的架构边界、目录结构、安全规则和修复约束？**

AI-RULES 会在项目里生成一组规则文件：

```text
.ai-rules/
├── .ai-rules.md
├── rules-config.json
├── config.json
└── cache/
    └── audit-context.json
```

这几个文件分别负责不同事情：

- `.ai-rules.md`：具体规则，比如 UI 层不能直接请求 API、Controller 不能直接依赖 Repository
- `rules-config.json`：启用哪些规则、严重级别、扫描范围、例外规则
- `config.json`：项目目录结构映射，比如 `@controller`、`@service`、`@api`
- `audit-context.json`：审计时生成的结构化上下文，方便调试和集成

也就是说，它不是让 AI “凭感觉读 README”，而是给 AI 一套明确的规则输入。

## 它能带来什么实际收益？

### 1. 减少重复 Review

很多团队的 code review 里，会反复出现类似评论：

“这里不要在 Controller 写业务逻辑。”

“这里不要直接在组件里调接口。”

“这里日志不要打印 token。”

“这里要走统一 service 层。”

“这个列表接口需要分页上限。”

这些规则如果每次都靠人提醒，非常低效。

AI-RULES 的做法是把这些高频规则沉淀成模板，让 AI 每次审计和修复前都能读取同一套约束。

### 2. 让 AI 输出更贴近项目架构

AI 生成代码经常“语法没问题，架构不对”。

例如在 Spring 项目里，它可能直接在 Controller 中访问 Repository；在前端项目里，它可能直接在页面组件中 `fetch`；在 FastAPI 项目里，它可能在 route 里直接操作 DB session。

AI-RULES 内置了一批高价值规则，覆盖：

- Frontend / React / Vue
- Python Base / FastAPI
- Java / Spring
- C / C++

例如 Java/Spring 模板里就有类似规则：

```md
### RULE: JAVA-ARCH-101
severity: FATAL
scope: architecture
intent: Controllers must not depend on repositories directly.

detect:
  regex: "@RestController[\\s\\S]*@Autowired[\\s\\S]*Repository"
  where: filePath in @mainJava/**
fix: Move business/data access logic into service layer.
context:
  - @service
```

这里的 `@service`、`@mainJava` 并不是写死的目录，而是来自 `config.json`：

```json
{
  "pathAliases": {
    "@mainJava": "src/main/java",
    "@controller": "src/main/java/**/controller",
    "@service": "src/main/java/**/service",
    "@repository": "src/main/java/**/repository"
  }
}
```

如果你的项目不是标准 Maven 目录，也可以只改 `config.json`，不需要改每条规则。

### 3. 提升安全性

AI-RULES 不是安全扫描器的替代品，但它可以在 AI 编码阶段提前约束一些高风险模式。

目前内置规则已经覆盖了不少常见问题：

前端：

- `innerHTML` / `dangerouslySetInnerHTML`
- `eval()` / `Function()`
- 前端硬编码 token / API key
- 第三方 script 缺少 SRI
- 不可信富文本进入 DOM sink 的语义风险

FastAPI / Python：

- SQL 字符串拼接
- 弱哈希算法 MD5 / SHA1
- 日志泄露 password / token / secret
- 外部 HTTP 调用缺少 timeout
- 列表接口缺少分页上限

Java / Spring：

- 过宽 CORS
- 敏感接口缺少显式 authn/authz
- 过宽 `permitAll()`
- 异常处理器泄露堆栈
- 日志泄露凭据
- 写操作缺少事务边界

它的价值不是宣称“完全安全”，而是让 AI 在写代码之前，就知道这些是团队不接受的模式。

## 怎么用？

安装：

```bash
npm install -g ai-law
```

进入你的项目：

```bash
cd your-project
```

初始化规则：

```bash
ai-law init
```

CLI 会让你选择语言和模板，例如：

```text
Select locale
> zh-CN - Simplified Chinese (complete)
  en - English (complete)
  zh-TW - Traditional Chinese (partial, falls back to English)
  ja - Japanese (partial, falls back to English)
  ko - Korean (partial, falls back to English)
  es - Spanish (partial, falls back to English)
  fr - French (partial, falls back to English)

Select template
> java-spring
  python-fastapi
  react-ts
  vue
  c-cpp
```

初始化后，会生成 `.ai-rules/` 目录。

然后检查配置是否合理：

```bash
ai-law doctor
```

如果你的目录映射不对，它会给出显眼警告，例如：

```text
========== AI-RULES WARNING ==========
IMPORTANT: pathAliases.@controller points to 'src/main/java/**/controller',
but 'src/main/java' was not found. Open .ai-rules/config.json and update this alias for your project layout.
========================================
```

这时你只需要打开：

```text
.ai-rules/config.json
```

把路径改成你项目里的真实目录，比如：

```json
{
  "pathAliases": {
    "@controller": "app/controllers",
    "@service": "app/services",
    "@repository": "app/repositories"
  }
}
```

然后生成 AI 审计 Prompt：

```bash
ai-law audit
```

或者直接查看结构化上下文：

```bash
ai-law audit --json
```

也可以把上下文写到文件：

```bash
ai-law audit --dump-context
```

这会生成：

```text
.ai-rules/cache/audit-context.json
```

AI 工具根据审计 Prompt 输出 `ai-rule-report.json` 后，可以继续校验报告格式：

```bash
ai-law validate-report
```

最后生成修复 Prompt：

```bash
ai-law fix --issueId ISSUE-001
```

或者批量生成修复 Prompt：

```bash
ai-law fix --all --group-by-rule
```

## 它生成的 Prompt 有什么不同？

普通 Prompt 可能是：

```text
请帮我检查代码有没有架构问题。
```

这种提示非常依赖 AI 自己猜。

AI-RULES 生成的 Prompt 会明确告诉 AI：

- 先读取 `.ai-rules/rules-config.json`
- 再读取 `.ai-rules/config.json`
- 再读取 `.ai-rules/.ai-rules.md`
- 只审计 `enabledRuleIds` 中启用的规则
- 使用 `pathAliases` 解析项目目录
- 尊重 `exceptions`
- `context` 是辅助上下文，不是唯一检查范围
- `regex/import/include` 规则优先使用本地 evidence
- `ast/semantic` 规则可以用 AI 判断，但要诚实表达置信度
- 最终只能输出约定 JSON schema

这会显著降低 AI 输出漂移。

## 一个输出案例

假设 AI-RULES 发现 Spring Controller 里直接依赖 Repository，生成的报告可能是：

```json
{
  "version": "1.1",
  "summary": {
    "total": 1,
    "fatal": 1,
    "warn": 0,
    "info": 0
  },
  "violations": [
    {
      "issueId": "ISSUE-001",
      "ruleId": "JAVA-ARCH-101",
      "severity": "FATAL",
      "confidence": 0.92,
      "file": "src/main/java/com/example/controller/UserController.java",
      "line": 18,
      "description": "Controller directly depends on Repository.",
      "fixSuggestion": "Move repository access into the service layer and inject the service into the controller.",
      "repairPrompt": "Refactor UserController to call UserService instead of UserRepository while preserving endpoint behavior."
    }
  ]
}
```

接着你可以运行：

```bash
ai-law fix --issueId ISSUE-001
```

它会基于规则元数据、上下文路径、报告证据，生成更聚焦的修复 Prompt，而不是让 AI 盲目改整块代码。

## 和 Harness 这类工具有什么区别？

我认为最核心的区别是：

**Harness 更偏向治理代码仓库边界；AI-RULES 更偏向治理 AI 写代码的过程。**

Harness 这类平台很适合做：

- 分支保护
- PR 规则
- reviewer 要求
- CODEOWNERS
- 禁止 force push
- secret scanning
- 合并前检查

这些能力非常重要，它们保护的是代码进入仓库和合并前的边界。

但 AI-RULES 解决的是另一个问题：

**在代码进入 PR、CI、merge gate 之前，AI 是否已经知道应该怎么写？**

所以更准确的表达是：

> Harness governs the repository boundary.  
> AI-RULES governs the AI coding behavior.

两者不是替代关系，而是互补关系。

如果你已经有 Harness 或其它代码治理平台，AI-RULES 仍然有价值，因为它可以把治理提前到 AI 生成代码的阶段，减少后面被 CI、Review、合并规则拦下来的次数。

## 当前边界

AI-RULES 现在还不是完整静态分析器。

目前本地 evidence 支持：

- `regex`
- `import`
- `include`

而：

- `ast`
- `semantic`

仍然是 AI-guided，也就是由 CLI 提供结构化规则和上下文，再由 AI 做最终判断。

我觉得这是一个比较务实的阶段：不虚假承诺“完全自动检测”，但已经能让 AI 审计和修复显著更稳定。

## 总结

AI 编程工具真正进入工程化使用后，最重要的问题不再是“它能不能写代码”，而是：

**它能不能按照我们团队的方式写代码？**

AI-RULES 想解决的就是这个问题。

它把团队规则变成 AI 可以消费的本地协议，让 AI 在编码、审计、修复时都更贴合项目架构、安全边界和目录结构。

如果你也在团队里使用 Codex、Cursor、Claude Code 或类似 AI 编码工具，并且经常遇到“AI 写得能跑，但不符合项目规范”的问题，AI-RULES 应该会很适合你。
