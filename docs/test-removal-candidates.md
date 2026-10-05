# Provisional test consolidation candidates

Status: 100 existing standalone test blocks reviewed at commit `68cb32a7`. No tests were removed.

These 100 blocks are candidates for **consolidation or rewrite**. The reasons apply to their current form. Keep useful behavior coverage before removing a block.

The audit uses the isolated `audit/test-removal-candidates` worktree. The first three groups cover repeated provider patterns.

| Group | Blocks | Why these blocks are weak | Coverage to keep |
|---|---:|---|---|
| Server model catalog and shortlists | 38 | Standalone provider tests repeat catalog literals or the same shortlist rule. | Keep provider differences and exact external limits only where they are a requirement. |
| Web model capability flags | 21 | Provider names change, but the two Boolean branches stay the same. | Keep one row for every required provider and each opt-in rule. |
| Provider instance catalog selection | 10 | The saved shortlist and fallback shapes repeat across providers. | Keep provider-specific differences as rows. |
| Unknown worker errors | 5 | Each block repeats one setup and one exact error phrase. | Keep rejection checks for all five public methods. |
| Prompt wording | 7 | The assertions depend on prose that can change without changing tool access. | Keep gate behavior and untrusted-document safety checks. |
| User context layout | 5 | Literal template and spacing assertions duplicate the format. | Keep parse and render round trips. |
| CLI text basics | 7 | Plain text inputs exercise narrower cases than nearby ANSI and wide text cases. | Keep width, escape, and boundary behavior. |
| Artifact type literals | 3 | Static extension lists are copied into test expectations. | Keep fallback and key supported types. |
| Workflow display labels | 4 | Tests depend on exact display words. | Keep state and result shape checks. |

| # | Test | Reason and safe change |
|---:|---|---|
| 1 | [`resolves catalog models for Xiaomi MiMo`](../apps/server/src/providers/models.test.ts#L82) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 2 | [`resolves catalog models for OpenAI`](../apps/server/src/providers/models.test.ts#L100) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 3 | [`exposes OpenAI API limits and base text prices without changing selections`](../apps/server/src/providers/models.test.ts#L107) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 4 | [`resolves catalog models for Gemini`](../apps/server/src/providers/models.test.ts#L138) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 5 | [`exposes current Gemini limits and standard text prices without changing defaults`](../apps/server/src/providers/models.test.ts#L143) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 6 | [`exposes current Anthropic limits and prices while preserving selections`](../apps/server/src/providers/models.test.ts#L170) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 7 | [`resolves catalog models for OpenCode Go`](../apps/server/src/providers/models.test.ts#L217) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 8 | [`resolves catalog models for DeepSeek`](../apps/server/src/providers/models.test.ts#L230) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 9 | [`resolves catalog models for Together AI`](../apps/server/src/providers/models.test.ts#L273) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 10 | [`resolves catalog models for Vercel AI Gateway`](../apps/server/src/providers/models.test.ts#L301) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 11 | [`resolves catalog models for Mistral`](../apps/server/src/providers/models.test.ts#L327) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 12 | [`resolves catalog models for Qwen DashScope intl and CN`](../apps/server/src/providers/models.test.ts#L349) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 13 | [`resolves catalog models for Doubao`](../apps/server/src/providers/models.test.ts#L364) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 14 | [`resolves the current Perplexity Sonar catalog`](../apps/server/src/providers/models.test.ts#L420) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 15 | [`resolves catalog models for Cerebras`](../apps/server/src/providers/models.test.ts#L432) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 16 | [`resolves catalog models for Fireworks`](../apps/server/src/providers/models.test.ts#L449) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 17 | [`resolves official Cloudflare 8B catalog ids`](../apps/server/src/providers/models.test.ts#L458) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 18 | [`keeps Moonshot region catalogs independent`](../apps/server/src/providers/models.test.ts#L548) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 19 | [`reads Xiaomi MiMo vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L563) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 20 | [`reads Together AI vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L622) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 21 | [`reads Vercel AI Gateway vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L628) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 22 | [`reads Mistral vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L637) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 23 | [`reads Qwen DashScope vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L643) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 24 | [`reads Doubao vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L651) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 25 | [`reads Perplexity vision flags from the curated catalog`](../apps/server/src/providers/models.test.ts#L661) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 26 | [`uses xiaomi custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L72) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 27 | [`resolves custom shortlist models for OpenAI`](../apps/server/src/providers/models.test.ts#L161) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 28 | [`keeps DeepSeek custom shortlist defaults and selections`](../apps/server/src/providers/models.test.ts#L252) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 29 | [`uses together custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L289) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 30 | [`uses vercel_ai_gateway custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L317) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 31 | [`uses mistral custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L337) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 32 | [`uses qwen custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L391) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 33 | [`uses doubao custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L404) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 34 | [`uses cerebras custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L437) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 35 | [`uses fireworks custom model shortlist when provided`](../apps/server/src/providers/models.test.ts#L470) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 36 | [`resolves MiniMax models from discovered custom models`](../apps/server/src/providers/models.test.ts#L490) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 37 | [`resolves Zhipu GLM models from discovered custom models`](../apps/server/src/providers/models.test.ts#L511) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 38 | [`resolves Moonshot models from discovered custom models`](../apps/server/src/providers/models.test.ts#L530) | Catalog or shortlist case. Fold the provider row into one model matrix; remove this standalone block. |
| 39 | [`treats xiaomi models as opt-in only for thinking`](../apps/web/src/lib/models.test.ts#L155) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 40 | [`treats openai-compatible models as opt-in only`](../apps/web/src/lib/models.test.ts#L171) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 41 | [`treats openrouter models as opt-in only`](../apps/web/src/lib/models.test.ts#L203) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 42 | [`treats deepseek models as opt-in only`](../apps/web/src/lib/models.test.ts#L219) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 43 | [`treats together models as opt-in only for thinking`](../apps/web/src/lib/models.test.ts#L235) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 44 | [`treats vercel_ai_gateway models as opt-in only for thinking`](../apps/web/src/lib/models.test.ts#L251) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 45 | [`treats mistral models as opt-in only`](../apps/web/src/lib/models.test.ts#L267) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 46 | [`treats qwen models as opt-in only for thinking`](../apps/web/src/lib/models.test.ts#L283) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 47 | [`treats doubao models as opt-in only`](../apps/web/src/lib/models.test.ts#L306) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 48 | [`treats perplexity models as opt-in only`](../apps/web/src/lib/models.test.ts#L322) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 49 | [`treats cerebras models as opt-in only`](../apps/web/src/lib/models.test.ts#L338) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 50 | [`treats fireworks models as opt-in only`](../apps/web/src/lib/models.test.ts#L354) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 51 | [`treats xiaomi models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L372) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 52 | [`treats openai-compatible and opencode_go models as opt-in only`](../apps/web/src/lib/models.test.ts#L388) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 53 | [`treats doubao models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L427) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 54 | [`treats cerebras models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L443) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 55 | [`treats together models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L459) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 56 | [`treats qwen models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L475) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 57 | [`treats vercel_ai_gateway models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L491) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 58 | [`treats fireworks models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L507) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 59 | [`treats openrouter models as opt-in only for vision`](../apps/web/src/lib/models.test.ts#L523) | Same opt-in branch. Keep this provider as a data row in one thinking or vision matrix. |
| 60 | [`uses shortlist when custom models are saved`](../apps/server/src/providers/compatible-models.test.ts#L66) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 61 | [`returns full catalog when no shortlist is saved`](../apps/server/src/providers/compatible-models.test.ts#L81) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 62 | [`uses shortlist when custom models are saved`](../apps/server/src/providers/compatible-models.test.ts#L96) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 63 | [`uses shortlist when custom models are saved`](../apps/server/src/providers/compatible-models.test.ts#L115) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 64 | [`returns full catalog when no shortlist is saved`](../apps/server/src/providers/compatible-models.test.ts#L132) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 65 | [`uses shortlist only when custom models are saved`](../apps/server/src/providers/compatible-models.test.ts#L149) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 66 | [`uses shortlist only when custom models are saved`](../apps/server/src/providers/compatible-models.test.ts#L229) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 67 | [`falls back to static catalog when no shortlist is saved`](../apps/server/src/providers/compatible-models.test.ts#L248) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 68 | [`uses shortlist only when custom models are saved`](../apps/server/src/providers/compatible-models.test.ts#L263) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 69 | [`falls back to static catalog when no shortlist is saved`](../apps/server/src/providers/compatible-models.test.ts#L287) | Same saved-shortlist or catalog fallback branch. Keep provider input and result in one matrix. |
| 70 | [`throws for unknown worker`](../apps/server/src/services/worker-manager-service.test.ts#L284) | Repeated unknown-worker guard. Keep each public method in one table of rejected inputs. |
| 71 | [`throws for unknown worker`](../apps/server/src/services/worker-manager-service.test.ts#L331) | Repeated unknown-worker guard. Keep each public method in one table of rejected inputs. |
| 72 | [`throws for unknown worker`](../apps/server/src/services/worker-manager-service.test.ts#L356) | Repeated unknown-worker guard. Keep each public method in one table of rejected inputs. |
| 73 | [`throws for unknown worker`](../apps/server/src/services/worker-manager-service.test.ts#L542) | Repeated unknown-worker guard. Keep each public method in one table of rejected inputs. |
| 74 | [`throws for unknown worker`](../apps/server/src/services/worker-manager-service.test.ts#L648) | Repeated unknown-worker guard. Keep each public method in one table of rejected inputs. |
| 75 | [`buildChatSystemPrompt includes automation skill pointer when create_automation is available`](../packages/agent/src/chat-prompt.test.ts#L23) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 76 | [`buildChatSystemPrompt omits gated guidance for write_file-only sessions`](../packages/agent/src/chat-prompt.test.ts#L31) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 77 | [`buildChatSystemPrompt includes /learn recognition when skill_manage is available`](../packages/agent/src/chat-prompt.test.ts#L46) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 78 | [`buildChatSystemPrompt includes memory skill pointers when file tools are available`](../packages/agent/src/chat-prompt.test.ts#L53) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 79 | [`buildChatSystemPrompt omits artifact guidance when write_file is unavailable`](../packages/agent/src/chat-prompt.test.ts#L61) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 80 | [`buildChatSystemPrompt omits USER.md section when empty`](../packages/agent/src/chat-prompt.test.ts#L101) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 81 | [`buildChatSystemPrompt gives messaging style to the four chat channels only`](../packages/agent/src/chat-prompt.test.ts#L112) | Checks prompt prose or repeated gating. Keep one behavioral gate check; remove exact wording checks. |
| 82 | [`USER_CONTEXT_TEMPLATE is the field labels as empty bullets`](../packages/core/src/user-context.test.ts#L29) | Checks literal template or output layout. Keep parse/render round-trip and field behavior. |
| 83 | [`renderUserContext leaves blank answers out of the file`](../packages/core/src/user-context.test.ts#L50) | Checks literal template or output layout. Keep parse/render round-trip and field behavior. |
| 84 | [`renderUserContext keeps extra notes below the bullets`](../packages/core/src/user-context.test.ts#L60) | Checks literal template or output layout. Keep parse/render round-trip and field behavior. |
| 85 | [`renderUserContext keeps extra notes even with no answers`](../packages/core/src/user-context.test.ts#L73) | Checks literal template or output layout. Keep parse/render round-trip and field behavior. |
| 86 | [`parseUserContext reads the template back as blank answers`](../packages/core/src/user-context.test.ts#L82) | Checks literal template or output layout. Keep parse/render round-trip and field behavior. |
| 87 | [`leaves plain text alone`](../apps/cli/src/text-measure.test.ts#L43) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 88 | [`counts plain characters`](../apps/cli/src/text-measure.test.ts#L49) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 89 | [`ignores ansi codes`](../apps/cli/src/text-measure.test.ts#L53) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 90 | [`wraps plain text by visible width`](../apps/cli/src/text-measure.test.ts#L64) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 91 | [`preserves explicit newlines`](../apps/cli/src/text-measure.test.ts#L68) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 92 | [`returns empty line for empty input`](../apps/cli/src/text-measure.test.ts#L86) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 93 | [`leaves short text unchanged`](../apps/cli/src/text-measure.test.ts#L98) | Basic identity or ordinary text case. Keep ANSI, wide-character, and boundary cases. |
| 94 | [`maps common text extensions`](../packages/core/src/artifact-mime.test.ts#L17) | Static extension map. Keep one representative and fallback; avoid repeated catalog copies. |
| 95 | [`maps common video extensions`](../packages/core/src/artifact-mime.test.ts#L26) | Static extension map. Keep one representative and fallback; avoid repeated catalog copies. |
| 96 | [`maps code and data files to a highlight language`](../packages/core/src/artifact-mime.test.ts#L96) | Static extension map. Keep one representative and fallback; avoid repeated catalog copies. |
| 97 | [`formatListWorkflowsToolResult is one line per workflow`](../apps/web/src/lib/chat-stream-workflow.test.ts#L93) | Checks display text. Keep data/state behavior and remove exact label wording. |
| 98 | [`tool activity labels keep long inputs in details`](../apps/web/src/lib/chat-stream-workflow.test.ts#L120) | Checks display text. Keep data/state behavior and remove exact label wording. |
| 99 | [`formatWorkflowRunStatusLabel covers run states`](../apps/web/src/lib/chat-stream-workflow.test.ts#L289) | Checks display text. Keep data/state behavior and remove exact label wording. |
| 100 | [`describeWorkflowStep and titles stay human`](../apps/web/src/lib/chat-stream-workflow.test.ts#L302) | Checks display text. Keep data/state behavior and remove exact label wording. |

## Scope and check

This list identifies 100 standalone blocks for deeper review. It does not prove that 100 scenarios can disappear. Check remaining coverage for each item before changing tests. Run each changed test file and `bun run test` after any removal.
