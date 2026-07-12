---
type: spec
record_id: SPEC-DOC-LIFECYCLE-001
status: archived
created: 2026-07-11
updated: 2026-07-11
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
docs_impact:
  user:
    - docs/user/README.md
    - docs/user/guide.md
    - docs/user/configuration.md
    - docs/user/concepts.md
  developer:
    - docs/developer/README.md
    - docs/developer/documentation-lifecycle.md
    - docs/developer/contributing.md
    - docs/developer/development.md
    - docs/developer/api.md
    - docs/developer/architecture.md
    - docs/developer/build-and-release.md
    - docs/developer/issues/README.md
    - docs/developer/issues/2026-07-11-product-readiness-audit.md
  product_status: true
archived_at: 2026-07-11
outcome: completed
implementation_refs:
  - same_change
same_change: true
---

# 文档生命周期与开发门禁设计

## 背景

Marginalia 已经形成了 user、developer、internal 和 Superpowers 四组文档，但它们没有统一的生命周期。开发通常从 `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 开始，代码完成后，计划仍保留为活跃文档，正式用户文档和开发者文档则可能没有同步。现有文档检查只验证部分源码引用，无法发现 API 已实现但 API 文档没有记录、计划状态与代码状态相反等问题。

本设计把 Superpowers 文档限定为临时开发资料，新增当前产品状态的唯一入口，并用可执行门禁约束代码、API 和文档的同步关系。

## 目标

1. 保存 2026-07-11 审计得到的当前进度、发布阻断问题和验证基线。
2. 明确每类文档的唯一职责，避免同一事实同时在多个位置维护。
3. 建立 Superpowers spec/plan 从创建、实施到关闭归档的完整流程。
4. 对 API、配置、权限、数据库、打包等高信号变化执行自动文档影响检查。
5. 把本地验证收敛为少量稳定命令，并在 PR CI 中强制执行。
6. 让 Codex 和 Claude 读取同一份仓库规则，不再维护两份内容相同的 agent 指令。

## 非目标

- 不重写全部历史文档。
- 不引入文档站点、OpenAPI 生成器或新的文档框架。
- 不尝试用自动化判断自然语言描述是否完全准确。
- 不要求每个内部 React 重构都修改用户文档。
- 不把详细 commit 流水账放进产品状态页。
- 不机械补勾旧计划中的所有 checkbox。

## 文档权威边界

| 位置                      | 唯一职责                                 | 当前事实来源         |
| ------------------------- | ---------------------------------------- | -------------------- |
| `README.md`               | 稳定的产品介绍、快速开始和导航           | 摘要，不保存详细进度 |
| `docs/product/status.md`  | 能力状态、发布阻断、验证基线、下一里程碑 | 产品状态唯一事实源   |
| `docs/user/`              | 用户当前可用行为、限制、隐私和数据边界   | 用户契约             |
| `docs/developer/`         | 当前架构、API、开发、验证和发布规范      | 工程契约             |
| `docs/superpowers/specs/` | 活跃变更的设计意图和决策                 | 只约束当前变更       |
| `docs/superpowers/plans/` | 活跃变更的执行步骤和进度                 | 临时执行记录         |
| `docs/developer/issues/`  | 具体问题、证据、状态和修复目标           | 问题详情             |
| `docs/internal/`          | 已完成、取消或被替代的历史资料           | 不作为当前事实       |

源码和测试提供可执行行为的最终证据。正式 user/developer 文档必须与这些行为一致；发生冲突时，相关开发任务不能关闭。

## 产品状态页

新增 `docs/product/status.md`，记录经过验证的快照，而不是实时流水账。文件顶部必须包含：

```text
Stage: Alpha
Release decision: NO-GO
Snapshot date: 2026-07-11
Verified commit: 1199645
Next milestone: M0 - Trustworthy Local Alpha
```

### 能力状态

能力只使用以下状态：

- `implemented`：主路径可用，已有对应验证。
- `partial`：纵向链路存在，但仍有明确边界或发布阻断。
- `disabled`：代码或入口存在，但正常产品路径不可用。
- `planned`：尚未实现。

每项能力使用稳定 ID，并记录用户结果、状态、发布门槛、已实现边界、关键缺口、稳定证据和目标里程碑。初始矩阵至少覆盖：

- Desktop shell 与本地 server
- Workspace 与 session
- Provider 与 model
- Streaming chat 与长文渲染
- Agent tools 与审批
- 文档浏览与资料上下文
- 导出与保存到 workspace
- Run 生命周期与恢复
- Skills
- MCP
- 打包与发布
- 文档与质量门禁

能力状态与发布门槛分开记录。一个能力可以是 `implemented`，同时仍因安全或恢复问题标记为 P0/P1。

### 问题状态

状态页只保留 P0/P1 摘要和稳定 ID，详细证据写入 `docs/developer/issues/2026-07-11-product-readiness-audit.md`。问题状态使用 `open`、`in-progress`、`blocked`、`resolved`，每项必须有最后验证日期和目标里程碑。

### 更新规则

以下变化必须更新状态页：

- 能力状态发生变化。
- 新增或关闭 P0/P1。
- 发布决定或下一里程碑变化。
- 完成一次新的全量验证快照。

普通 bug fix、重构和逐 commit 记录不进入状态页。文件顶部的日期和 commit 让过期快照显式可见，不能省略。

## Superpowers 生命周期

### 状态模型

```text
draft -----> approved -----> active -----> completed
  |             |              |
  +-------------+--------------+---------> cancelled
  +-------------+--------------+---------> superseded
```

`completed`、`cancelled` 和 `superseded` 是关闭动作的逻辑结果，不会作为活跃目录中的持久状态。`docs/superpowers/` 只允许 `draft`、`approved` 和 `active`；关闭时必须在同一个改动中写入 outcome、从活跃索引移除，并把文档移到 `docs/internal/specs/` 或 `docs/internal/plans/`，归档后的持久状态统一为 `archived`。

### 活跃文档元数据

每个 spec/plan 使用一致的 front matter：

```yaml
type: spec | plan
record_id: SPEC-domain-001 | PLAN-domain-001
status: draft | approved | active
created: YYYY-MM-DD
updated: YYYY-MM-DD
target_milestone: milestone-id
owner: role-or-name
source_spec_id: required-for-plan
docs_impact:
  user:
    - docs/user/guide.md
  developer:
    - docs/developer/api.md
  product_status: true
```

`record_id` 创建后永不改变，并在 active 与 internal 全局唯一。Plan 必须通过 `source_spec_id` 引用 spec 的稳定 ID；检查器在 active 和 internal 中解析该 ID，因此 spec 移动归档不会使引用失效。所有活跃文档必须按稳定 ID 出现在 `docs/superpowers/README.md`。

### 实施规则

- Spec 在设计确认后变为 `approved`，开始实施时变为 `active`。
- Plan 的任务必须形成可交付闭环，不能把正式文档的首次更新统一推迟到最后一个任务。
- 行为一旦进入正常产品路径，同一任务必须更新相应 user/developer 文档。
- 暂时没有正式文档的行为必须保持在 feature flag 或不可达路径之后。
- 完成任务时同步 plan 进度，不能只提交代码。
- 实现偏离设计时，先在 spec 的 Deviation 区记录原因和新决策。

### 关闭与归档

关闭前，plan 必须增加 `Implementation Outcome`，包含：

- 实际完成内容
- 未完成或取消内容
- 与 spec 的偏差
- 验证命令和结果
- 已更新的正式文档
- 实现 commit 或 PR；如果与 closeout 同一变更，明确记录 `same_change`
- 遗留 issue

随后完成以下动作：

1. 更新 user/developer/status。
2. 把未完成工作转成 issue 或新 spec。
3. 从活跃索引移除。
4. 将 spec/plan 移到 internal。
5. 写入归档元数据：

```yaml
status: archived
record_id: unchanged-stable-id
archived_at: YYYY-MM-DD
outcome: completed | cancelled | superseded
implementation_refs:
  - commit-or-pr-or-same_change
superseded_by_id: required-only-when-outcome-is-superseded
same_change: optional-true-only-when-created-and-closed-in-one-change
```

`outcome: completed` 只允许从 `active` 关闭；`cancelled` 和 `superseded` 可从任意活跃状态关闭。`superseded_by_id` 在 outcome 为 `superseded` 时必填且目标 ID 必须存在，其他 outcome 禁止填写。取消原因、完成摘要或替代原因写入 `Implementation Outcome`。检查器不允许关闭结果只改 front matter 而未移动文件，也不允许归档文件继续出现在活跃索引。

现有 approval backbone 与 message stream 计划按实际实现写 closeout。已经完成的能力按提交和测试确认；未完成任务转成 issue，不补写虚假的完成记录。

## 开发流程与完成定义

新增 `docs/developer/documentation-lifecycle.md`，作为人类和 agent 共用的流程规范。一个功能只有同时满足以下条件才算完成：

1. 测试先行，代码实现完成。
2. 受影响的 user/developer 文档已更新。
3. 能力或发布门槛变化已同步到产品状态页。
4. API、配置、数据库、权限和发布契约通过对应检查。
5. 活跃 spec/plan 已同步进度和偏差。
6. UI 变化已完成 Electron 截图和视觉差异裁决。
7. `pnpm verify` 通过。
8. 功能关闭时已完成 closeout 和归档。

文档影响矩阵：

| 变更                               | 必须更新                              |
| ---------------------------------- | ------------------------------------- |
| 用户流程、控件、导入导出、错误表现 | `docs/user/`                          |
| 权限、安全、隐私、数据发送和存储   | 用户指南、配置和相关 developer 文档   |
| HTTP、SSE、IPC、schema、数据库契约 | API 文档；主数据流变化时更新架构文档  |
| 环境变量、开发命令、测试方法       | 开发指南                              |
| 打包、签名、更新和发布             | 打包与发布文档                        |
| 能力状态或发布门槛                 | 产品状态页                            |
| 实现偏离设计                       | 活跃 spec 的 Deviation 和对应正式文档 |
| 新问题或安全发现                   | developer issue；状态页保存摘要       |
| 协作流程                           | 文档生命周期、贡献指南和 agent 规则   |

根 README 只在产品定位、核心能力、安装方式或导航变化时更新，不再镜像每一项用户功能。

## 自动化门禁

### 统一命令

根 `package.json` 新增：

```text
pnpm docs:check
pnpm verify
```

`pnpm verify` 顺序执行文档检查、格式检查、lint、typecheck、test 和 build。UI 视觉裁决保持独立，因为截图差异是否有意需要人工判断。

### 静态文档检查

第一版使用 Node 脚本和现有测试能力，不增加依赖。`docs:check` 检查：

- 当前文档的相对 Markdown 链接和 heading fragment。
- README、AGENTS、CLAUDE、product、user、developer 和活跃 Superpowers 中的源码路径与 symbol anchor。
- 正式文档禁止使用容易漂移的 `path:line` 引用。
- Superpowers front matter、稳定 ID 唯一性、`source_spec_id` 可解析性、合法状态和活跃索引完整性。
- 禁止关闭结果滞留在 Superpowers，并校验归档 outcome 的状态转换约束。
- 文档引用的简单根级 `pnpm <script>` 在 `package.json` 中存在。
- Agent 规则文件及其本地引用存在。

`docs/internal/` 的历史正文不做源码引用、格式或 Markdown 链接检查，避免旧实施记录中的示例路径和占位资源阻断首轮迁移。门禁只检查 `docs/internal/README.md` 的导航链接，以及归档 front matter 中 `source_spec_id`、`superseded_by_id` 等稳定 ID。新 closeout 必须把关键证据放在结构化元数据和 `Implementation Outcome` 中；历史正文仍保持只读。

普通静态 `docs:check` 只验证当前树结构，不能声称验证“从哪个状态关闭”。状态转换属于 PR diff 检查：检查器以稳定 `record_id` 关联 base 中的 active 文档和 HEAD 中的 archive，读取 base front matter 后验证 `completed` 的前态必须是 `active`，`cancelled`/`superseded` 的前态必须是 `draft`、`approved` 或 `active`。仅存在于 HEAD、却在 base 找不到同 ID 活跃记录的 archive 默认失败。

同一变更中新建并完成的短任务允许直接归档，但必须显式设置 `same_change: true`，outcome 只能是 `completed`，`implementation_refs` 必须包含精确机器值 `same_change`，并提供完整 `Implementation Outcome`。Plan 的 `source_spec_id` 必须解析到同一变更中归档的 spec；base 中不得存在相同 `record_id` 或相同路径。该例外只解决新记录无法出现在 PR base 的事实，不适用于任何已有 active 文档。

首轮迁移是唯一例外：`docs/contracts/superpowers-migration-baseline.json` 保存当前 legacy 文件的精确 source path、SHA-256、分配后的 `record_id` 和审计确认的 `assumedStatus`。转换检查仅在 base blob 与登记哈希完全一致时接受该前态。baseline 合并后保持只读；由于后续 merge base 已不再包含这些 source path，记录不能被重复使用。未采用新 front matter 的其他 legacy internal 正文不进入 ID 或转换检查。

### API 契约检查

当前 HTTP 路由集中在 `apps/pi-server/src/app.ts`。`docs/developer/api.md` 增加唯一的机器可读区间：

```md
<!-- route-inventory:start -->

| Method | Path      | Description |
| ------ | --------- | ----------- |
| GET    | `/health` | ...         |

<!-- route-inventory:end -->
```

检查器只解析该区间表格的前两列，并与 `app.get/post/put/patch/delete()` 中使用字符串字面量注册的 method/path 做无序集合全等比较。重复 method/path、动态路径、标记缺失或集合任一方向不一致都失败。正文其他位置提到的端点不进入 inventory；例如尚未实现的 `GET /workspaces/:id/branch` 必须放在标记区间之外，并明确标为 client-only gap。该检查可同时发现新增、删除和改名的服务端路由，但不判断描述文字是否准确。

如果后续路由改成动态注册，迁移到显式 route manifest 或 OpenAPI；第一版不提前引入这一层。

### Diff 影响检查

检查脚本接受可选的 base SHA。在 CI 中读取 PR base；本地可显式传 `--base`。检查器先计算 `git merge-base <base> HEAD`，分别比较 merge-base 到 Git index、Git index 到工作树，再并入未跟踪文件；因此 staged 与 unstaged 的相反内容不会抵消。干净 CI 中 index 与工作树都是 PR HEAD。所有 Git 路径进入匹配器前统一为 POSIX `/` 分隔符。该 diff 同时驱动文档影响和上一节的 Superpowers 状态转换检查。代码路径与正式文档的关系不硬编码在脚本中，而是保存在版本化的 `docs/contracts/docs-impact.json`。下面只展示 schema；实际 rule set 以该文件为准：

```json
{
  "version": 1,
  "rules": [
    {
      "id": "server-http-contract",
      "paths": ["apps/pi-server/src/app.ts"],
      "requireAll": ["docs/developer/api.md"]
    },
    {
      "id": "sse-contract",
      "paths": ["apps/pi-server/src/agent/agent-client.ts", "apps/desktop/src/api/sse-stream.ts"],
      "requireAll": ["docs/developer/api.md"]
    },
    {
      "id": "desktop-api-client",
      "paths": ["apps/desktop/src/api/**"],
      "requireAll": ["docs/developer/api.md"]
    },
    {
      "id": "database-contract",
      "paths": ["apps/pi-server/src/db/**"],
      "requireAll": ["docs/developer/api.md", "docs/user/configuration.md"]
    },
    {
      "id": "provider-config",
      "paths": [
        "apps/pi-server/src/providers/**",
        "apps/pi-server/src/agent/provider-id.ts",
        "apps/desktop/src/settings/**"
      ],
      "requireAll": ["docs/user/configuration.md", "docs/developer/api.md"]
    },
    {
      "id": "runtime-config",
      "paths": [
        "apps/pi-server/src/index.ts",
        "apps/pi-server/src/db/connection.ts",
        "apps/desktop/electron/pi-server-spawner.ts",
        "apps/desktop/electron/main.ts"
      ],
      "requireAll": ["docs/user/configuration.md", "docs/developer/development.md"]
    },
    {
      "id": "permissions-and-files",
      "paths": [
        "apps/pi-server/src/agent/agent-client.ts",
        "apps/pi-server/src/agent/approval-*.ts",
        "apps/pi-server/src/agent/document-tools.ts",
        "apps/pi-server/src/agent/pi-coding-agent-client.ts",
        "apps/pi-server/src/files/**",
        "apps/desktop/src/chat/ApprovalCard.tsx",
        "apps/desktop/src/chat/Composer/PermissionChip.tsx"
      ],
      "requireAll": [
        "docs/user/guide.md",
        "docs/user/configuration.md",
        "docs/developer/architecture.md"
      ]
    },
    {
      "id": "server-user-boundary",
      "paths": ["apps/pi-server/src/app.ts"],
      "changedLinePattern": "(provider|apiKey|baseUrl|defaultModel|permission|approval|rootDir|workspaceRoot|files|resolveWorkspacePath)",
      "requireAll": [
        "docs/user/guide.md",
        "docs/user/configuration.md",
        "docs/developer/architecture.md"
      ]
    },
    {
      "id": "developer-commands",
      "paths": ["package.json", "pnpm-workspace.yaml", "scripts/**"],
      "requireAll": ["docs/developer/development.md", "docs/developer/contributing.md"]
    },
    {
      "id": "documentation-contracts",
      "paths": ["AGENTS.md", "CLAUDE.md", "docs/contracts/**", ".github/pull_request_template.md"],
      "requireAll": ["docs/developer/documentation-lifecycle.md", "docs/developer/contributing.md"]
    },
    {
      "id": "desktop-release",
      "paths": [
        "apps/desktop/electron/**",
        "apps/desktop/electron-builder.yml",
        "apps/desktop/package.json",
        ".github/workflows/**"
      ],
      "requireAll": ["docs/developer/build-and-release.md"]
    },
    {
      "id": "agent-extensions",
      "paths": [
        "apps/pi-server/src/agent/pi-coding-agent-client.ts",
        "apps/desktop/src/settings/SettingsView.tsx"
      ],
      "requireAll": ["docs/product/status.md", "docs/developer/architecture.md"]
    }
  ]
}
```

第一版 glob 只支持字面路径、`*` 和 `**`；`changedLinePattern` 只匹配 unified diff 中真实新增/删除的行，不读取上下文行。一个规则命中后，`requireAll` 中每个文件都必须出现在 diff 中。新增高信号区域时，必须先更新这份映射和对应 fixture 测试。映射初始覆盖 HTTP/SSE、API client、数据库 migration、Provider/配置、权限/文件访问、Electron/打包/workflow 和 Skills/MCP 能力开关。

纯内部重构可以按规则豁免，但豁免必须通过机器可读声明传给检查器。PR 模板保存以下单行 JSON 注释；CI 从 `GITHUB_EVENT_PATH` 安全读取 PR body，不把正文插入 shell：

```html
<!-- docs-impact: {"version":1,"exemptions":[{"rule":"provider-config","reason":"仅重排内部缓存，不改变 provider 配置、运行时选择或用户行为"}]} -->
```

本地运行 diff 检查时使用 `--declaration <json-file>` 传入同一 JSON schema。PR body 中必须至多出现一个 `docs-impact` 注释；多个注释或 JSON 解析失败直接报错。每个 exemption 必须引用本次实际命中的 rule，reason 去除空白后至少 20 个字符；未知规则、重复豁免和空泛理由均失败。PR 中的 exemption 还必须由有 write 权限的维护者为当前 PR head 添加 `docs-impact-approved` label 才能生效；后续 push 或 PR body 编辑必须移除并重新添加 label。API route inventory、失效链接和 schema 错误属于不可豁免的静态契约。没有命中规则时不要求声明。普通 UI 组件重构不做自动强制，避免为了通过检查而产生无意义文档改动。

### PR CI

新增 `.github/workflows/ci.yml`：

- 触发所有 `pull_request` 和 `push`；当前远端默认分支是 `feat/approval-backbone`，不虚构尚不存在的 `main`。
- 使用 Node 22、pnpm 9.15.4 和 frozen lockfile。
- 运行 `pnpm verify`。
- 只有 `pull_request` 运行 diff 影响检查，base 固定取 `github.event.pull_request.base.sha`，并通过 `GITHUB_EVENT_PATH` 读取声明；checkout 使用完整历史以保证 base 可用。
- `push`（包括首次推送）只运行静态 `pnpm verify`，不需要 base SHA，也不重复裁决已经在 PR 中批准的豁免。

另增 `.github/workflows/docs-gate.yml`：通过 `pull_request_target` 从目标分支提取受信任 checker 和 docs-impact policy，检查事件中的精确 PR head，不执行 PR 脚本。仓库内容权限只读，额外的 `statuses: write` 只用于把 `trusted-docs` commit status 发布到精确 head SHA；`.github/CODEOWNERS` 保护 checker、contracts、workflow 和 agent 规则。

仓库 branch protection 需要把 `verify` 与 `trusted-docs` 配成 required checks，并启用 Code Owner review。视觉回归不放进第一版通用 PR CI。

### PR 模板

PR 必须填写：

- Docs impact 类别
- 更新的正式文档路径
- 产品状态页是否变化
- 活跃 spec/plan 是否需要 closeout
- 无文档影响时的具体原因
- 验证命令和人工验证证据

## Agent 规则只保留一份

根 `AGENTS.md` 是唯一规则源。现有 `CLAUDE.md` 内容迁入 `AGENTS.md`，随后把 `CLAUDE.md` 改为指向 `AGENTS.md` 的 Git symlink。仓库不新增职责不明的 `RTK.md`，并移除悬空引用。

文档检查同时验证：

1. Git index 中 `CLAUDE.md` 的模式是 `120000`，blob 内容严格等于 `AGENTS.md`。
2. 当前工作树中 `lstat(CLAUDE.md).isSymbolicLink()` 为真，`readlink` 结果严格等于 `AGENTS.md`。

因此 Windows 把链接物化为普通文本文件时 `pnpm docs:check` 会明确失败，而不会让 Claude 只读到字符串 `AGENTS.md`。`docs/developer/contributing.md` 记录前置条件：开启 Windows Developer Mode 或使用管理员权限，在 clone 前设置 `git config --global core.symlinks true`；已有物化 checkout 应在启用后重新 clone。首版不提供复制文件 fallback，因为那会重新引入双内容源。Ubuntu PR CI 也执行同一工作树检查。

## 当前资料迁移

本次实施按以下顺序进行：

1. 写入产品状态快照和详细 readiness issue。
2. 新增文档生命周期规范与 Superpowers 活跃索引。
3. 生成一次性 legacy baseline；为当前 spec/plan 分配稳定 ID，按实际状态写 closeout 并归档，或补齐元数据后保留 active。
4. 修正正式文档中已经确认的明显漂移，包括 API inventory 和文档引用规范冲突。
5. 增加 `docs:check`、`pnpm verify` 和测试。
6. 增加 PR 模板和 PR CI。
7. 收敛 AGENTS/CLAUDE，并验证 symlink。

本次迁移不格式化或校验 internal 历史正文中的链接，不重写旧计划内容，也不删除历史资料；只补归档元数据、closeout 和索引导航。

## Deviation

- 本次 design spec 和 implementation plan 都在当前变更中新建，如果仍要求 HEAD archive 必须在 PR base 中存在同 ID active 记录，就无法满足“完成后转为历史执行记录”。因此增加受限的 `same_change` 关闭规则。已有文档的转换规则和 legacy hash baseline 不变。
- 本地门禁用于提交前检查，diff 目标由只读 HEAD 扩展为 Git index 与工作树两段 diff，并覆盖 staged、unstaged 和 untracked；这样暂存内容不会被工作树反向改动抵消，干净 PR CI 的语义不变。
- 普通 `pull_request` workflow 会执行 PR checkout 中的 checker，不能单独保护门禁自身。因此增加目标分支提供的可信 docs gate、CODEOWNERS 和维护者 label 授权；深审后进一步把授权限定为当前 head 的新 label 事件，将可信结果显式发布到该 head SHA，并按 PR 串行化事件以防旧 run 覆盖新状态。仓库侧 required check/Code Owner review 仍需合并后配置。

## 错误处理

- 文档检查失败时输出触发规则、发生变化的代码文件和缺少的文档，不只返回通用错误。
- 无法解析的 front matter、未知状态、孤儿 active 文档和重复稳定 ID 都视为失败。
- Route 提取无法确定时失败并提示维护 route manifest，不能静默跳过。
- Diff base 不存在时，静态检查继续执行；显式请求 diff 检查或处于 PR CI 时视为失败。普通 `push` 不请求 diff 检查，因此不需要 base。
- 状态快照中的证据文件不存在或 symbol anchor 消失时失败。

## 验证策略

### 自动测试

- 文档链接、源码 anchor、状态 schema 和索引的正反用例。
- API route inventory 新增、删除和缺失文档用例。
- Diff 影响映射命中、未命中、文档满足和有效/无效豁免的用例。
- 关闭结果滞留在 Superpowers、非法 outcome 转换、重复 capability ID、Git index 或工作树软链错误等失败用例。
- 根 `pnpm docs:check`、`pnpm verify` 和现有全量检查。

### 人工验证

- 抽查产品状态页的能力状态与当前源码一致。
- 抽查 P0/P1 问题证据和目标里程碑。
- 确认当前 Superpowers 文档的 active/archived 分类。
- 在一个模拟 API 变化 diff 上确认门禁给出可执行错误。
- 确认 GitHub PR 模板和 CI 命令与本地一致。

## 验收标准

1. 新贡献者从 `docs/README.md` 能找到产品状态、当前规范、活跃计划和历史资料。
2. `docs/product/status.md` 完整保存本次进度、问题和验证基线。
3. `docs/superpowers/` 中没有完成或被替代的文档，也没有未被索引的活跃文档。
4. 新增或删除 HTTP 路由但不更新 API 文档时，`pnpm docs:check` 必须失败。
5. 高信号代码变化缺少对应文档时，PR CI 必须失败并指出缺少的文件。
6. 代码、测试和正式文档未同步时，开发任务不能关闭。
7. `AGENTS.md` 与 `CLAUDE.md` 只有一份内容源，悬空的 `RTK.md` 引用被移除。
8. `pnpm verify` 在当前分支通过。

## Implementation Outcome

- 实际完成：建立产品状态、readiness issue、用户/开发者正式文档和活跃/历史资料的职责边界。
- 实际完成：实现 `docs:check` 静态检查、API route inventory、diff impact、Superpowers 状态转换、归档不可变性和 AGENTS/CLAUDE symlink 契约。
- 实际完成：PR CI 与可信 gate 使用目标分支 checker，结果绑定精确 PR head，豁免绑定最新 label 事件并按 PR 串行执行。
- 迁移结果：approval backbone 与 message stream 计划按实际 outcome 归档，未完成消息流工作转入 `P1-MESSAGE-001`；P1 chat-core spec 继续 active。
- 未完成或取消：仓库外的 branch protection、required status 和 Code Owner enforcement 尚未配置，继续由 `P1-DOCS-001` 跟踪。
- 与设计的偏差：增加受限 `same_change` closeout、index/worktree 两段 diff、可信 head status 和不可信输入读取防护，均记录在本 spec 的 Deviation。
- 安全复核：初轮修复 staged/worktree 抵消、旧 label 复用、`pull_request_target` 状态归属和并发状态覆盖问题；2026-07-12 staged 深审又修复 same-change 归档自锁，并发现仍需由 `P1-DOCS-001` 收口的路由提取、影响映射和可信状态时效问题。
- 验证：`node --test scripts/docs-check.test.mjs` 27 项通过，`pnpm docs:check -- --base HEAD` 与 `pnpm verify` 通过；总计 449 项测试通过，1 项 live test 跳过。
- 正式文档：已同步 `docs/product/status.md`、`docs/user/`、`docs/developer/`、根 README 和文档索引。
- 实现引用：本设计、实现与 closeout 位于同一未提交变更，使用精确机器值 `same_change`。
- 遗留问题：文档门禁 staged 深审阻断以及产品安全、恢复、provider、视觉、发布、MCP/Skills 等问题保留在 readiness audit，不因本治理记录完成而关闭。
