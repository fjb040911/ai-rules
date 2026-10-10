# Review code

Read config-spec.md and report-spec.md. First inspect .ai-rules. If absent, initialize using initialize.md when the user authorized setup; otherwise explain that project rules are missing and request the needed setup choice. Do not present a generic review as an ai-rules review.

Honor the user's requested files, diff, rules, or scope intersected with configured scanning. Otherwise review configured source scope. Inventory relevant files and enabled rules. Split large reviews into manageable modules; preserve progress and record unreviewed ranges. Do not load every template or the entire repository into context at once.

Basic mode: use native file/search tools to gather candidates and read source with actual line positions. Review caller/callee context, exceptions, guards, cleanup, and architecture before confirming findings. Evaluate semantic rules and rules with no candidate matches too. Do not manufacture evidence IDs or label agent analysis local-ast/local-count/etc.

Enhanced mode: if ai-law is already available and the user hasn't requested basic mode, optionally run ai-law doctor and ai-law audit with the requested filters. The audit command prepares context and evidence; it does not perform the final review. Read its output and source to complete the review. Load cache details only as needed. Keep tool errors and unsupported checks in the coverage record; fall back to basic review where feasible. Do not use stale cached evidence as proof of current code.

Before reporting, verify each finding against the current source and enabled rule. Include a concrete file, line, snippet, explanation, and feasible repair. Distinguish uncertainties in the chat/coverage record rather than presenting unverified candidates as confirmed violations.

Write ai-rule-report.json using report-spec.md and .ai-rules/cache/skill-review-coverage.json recording mode (agent or agent+cli), requested scope, reviewed files/rule IDs, skipped files/rules and reasons, tool failures, and limitations. Keep coverage outside the 1.1 report contract. Recompute summary counts and check rule references and issue ID uniqueness. If an execution tool and ai-law are available, run ai-law validate-report; otherwise describe validation as an agent consistency check.

Show findings ordered by severity with file/line and rule ID, plus report location and material coverage limitations. A zero-finding report means no confirmed violations in the reviewed scope, not proof that the whole project is safe. Do not fix source code during a review-only request.
