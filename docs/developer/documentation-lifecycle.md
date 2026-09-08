# 文档生命周期

这份规范约束功能开发、正式文档和 Superpowers 执行记录。源码和测试提供可执行行为的证据；用户文档、开发者文档与行为冲突时，任务不能关闭。

## 每类文档只维护一种事实

| Location                  | Responsibility                                 |
| ------------------------- | ---------------------------------------------- |
| `README.md`               | 稳定的产品定位、快速开始和导航                 |
| `docs/product/status.md`  | 当前能力状态、P0/P1 摘要、验证基线和下一里程碑 |
| `docs/user/`              | 当前用户可用行为、限制、隐私和数据边界         |
| `docs/developer/`         | 当前架构、API、开发、验证和发布契约            |
| `docs/superpowers/specs/` | 活跃变更的设计意图和决策                       |
| `docs/superpowers/plans/` | 活跃变更的任务、依赖和进度                     |
| `docs/developer/issues/`  | 当前问题的证据、状态和验收条件                 |
| `docs/internal/`          | 已完成、取消或被替代的历史资料                 |

Internal 文档不提供当前行为保证。需要继续生效的规则应提升到 user、developer、status 或 `AGENTS.md`。

`docs/product/status.md` 是 issue 状态、最后验证日期和目标里程碑的当前来源。Readiness audit 的 inventory 是指向详细问题正文的受检镜像；`pnpm docs:check` 会比较两边的 ID、优先级、状态、日期和目标，任何不一致都会失败。

## 开发流程

### 设计确认

会改变功能、架构、安全边界或协作流程的工作先写 spec。Spec 在讨论时为 `draft`，用户确认后为 `approved`，开始实现时改为 `active`。未经确认的方案不进入正常产品路径。

每个活跃 spec/plan 使用稳定 `record_id`。Plan 必须通过 `source_spec_id` 指向 spec，并声明 `docs_impact`：

```yaml
type: plan
record_id: PLAN-example-001
status: active
created: 2026-07-11
updated: 2026-07-11
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
source_spec_id: SPEC-example-001
docs_impact:
  user:
    - docs/user/guide.md
  developer:
    - docs/developer/api.md
  product_status: true
```

### 实施

Plan 的每个任务应形成可验证的闭环。用户行为进入正常路径时，同一个任务更新测试和正式文档；不能把首次文档更新统一推迟到计划末尾。实现偏离设计时，先在 spec 的 Deviation 区记录原因和新决策。

代码变化对应的文档范围：

| Change                             | Required documentation                |
| ---------------------------------- | ------------------------------------- |
| 用户流程、控件、导入导出、错误表现 | `docs/user/`                          |
| 权限、安全、隐私、数据发送和存储   | 用户指南、配置和相关 developer 文档   |
| HTTP、SSE、IPC、schema、数据库契约 | API 文档；主数据流变化时同步架构文档  |
| 环境变量、开发命令、测试方法       | 开发指南                              |
| 打包、签名、更新和发布             | 打包与发布文档                        |
| 能力状态、P0/P1、发布决定          | 产品状态页和 readiness issue          |
| 实现偏离设计                       | 活跃 spec 的 Deviation 和对应正式文档 |
| 协作流程                           | 本文、贡献指南和 `AGENTS.md`          |

根 README 只在产品定位、核心能力、安装方式或导航变化时更新，不镜像详细进度。

### 验证

根级命令：

```bash
pnpm docs:check
pnpm verify
```

`pnpm verify` 运行文档检查、格式、lint、类型检查、测试和构建。视觉差异需要人工判断，因此保持独立：

```bash
pnpm verify:visual
```

UI 改动必须查看视觉报告，对每个 `changed` 选择修复或带原因更新基线。命令返回 0 但仍有 changed，不能写成视觉通过。

### 关闭和归档

完成前，plan 增加 `Implementation Outcome`，记录：

- 实际完成和未完成内容；
- 与 spec 的偏差；
- 验证命令与结果；
- 已更新的正式文档；
- 实现 commit 或 PR；
- 遗留 issue。

如果实现与 closeout 位于同一个尚未形成 commit 的变更，`implementation_refs` 可以使用一次 `same_change`。该例外只适用于 `outcome: completed`，而且同一 diff 中必须同时归档相互关联的 spec 和 plan，两者都引用 `same_change`。它只表示实现和归档同属当前 diff，不能替代已知的历史 commit/PR，也不能用于没有实现内容的文档整理。

关闭时在同一个改动中完成：

1. 更新 user、developer 和 status。
2. 把未完成工作转成 issue 或新 spec。
3. 从 `docs/superpowers/README.md` 移除记录。
4. 将 spec/plan 移入 `docs/internal/specs/` 或 `docs/internal/plans/`。
5. 写入归档元数据和 `Implementation Outcome`。

```yaml
status: archived
archived_at: 2026-07-11
outcome: completed
implementation_refs:
  - same_change
same_change: true
```

普通 `implementation_refs` 使用 7–40 位小写 Git commit SHA、`#123`/`PR#123`，或 GitHub commit/PR URL；`same_change` 引用必须同时设置 `same_change: true` 并满足上面的受限规则。`completed` 只允许从 `active` 关闭；`cancelled` 和 `superseded` 可从 `draft`、`approved` 或 `active` 关闭。`superseded` 必须填写可解析的 `superseded_by_id`。

首轮 legacy 迁移通常从 PR merge base 读取 baseline `sourcePath` 并核对 SHA-256。若 legacy 文档在同一分支中早于治理门禁创建、但晚于 merge base，baseline 可以额外固定完整 `sourceRevision`；检查器只接受位于 merge base 之后且为当前 HEAD 祖先的 commit，并从该 commit 读取同一路径后核对哈希。这个字段只用于一次性首轮迁移，baseline 合入后仍按字节锁定，不是普通 closeout 的替代方案。

归档记录一旦进入目标分支即按字节不可变。后续发现事实错误时，不直接改写历史正文或元数据；应在当前正式文档、issue 或新的 spec/plan 中更正，并保留原记录作为当时执行证据。

## 自动文档检查

### 当前树检查

`pnpm docs:check` 检查当前文档链接和 heading fragment、源码路径和 symbol anchor、根级 pnpm script、产品状态 schema、Superpowers 元数据和索引，以及 AGENTS/CLAUDE 规则文件。正式文档使用 `path` 或 `path#symbol`，不使用容易漂移的 `path:line`。CI 会在构建前运行这项检查，因此 `dist`、`dist-electron`、`release`、`resources`、`output` 等生成目录无论位于路径中间还是末尾，都不会被当成必须已存在的源码引用。

`docs/internal/` 的历史正文不参与源码引用和 Markdown 链接检查；归档元数据中的稳定 ID 仍会校验。

### API inventory

`docs/developer/api.md` 中只有以下标记区间参与路由集合比较：

```md
<!-- route-inventory:start -->

| Method | Path      | Description |
| ------ | --------- | ----------- |
| GET    | `/health` | 健康检查    |

<!-- route-inventory:end -->
```

检查器将前两列与 `apps/pi-server/src/app.ts` 中字符串字面量注册的 route 做无序集合全等比较。正文中的规划接口不进入 inventory。

### Diff impact

高信号代码路径与必须同步的正式文档保存在 `docs/contracts/docs-impact.json`。CI 以 PR base 和 HEAD 的 merge-base 计算三点 diff。规则命中后，`requireAll` 中每个文件都必须出现在 diff 中。

Skills 的 `skills-management` 规则覆盖 server catalog、显式 prompt serialization、session history
normalization、Pi runtime injection、agent session cache，以及 desktop `useSkillCatalog`/streaming hooks、
Composer、Chat/New chat、blocked repair、AppShell/Sidebar Settings composition、Settings 和 store。
`skills-desktop-api` 与 `skills-route-composition` 还用窄 changed-line pattern 覆盖 desktop client 的
Skills DTO/调用，以及 `app.ts` 中的 Skills route、snapshot、runtime 与 canonical-root 组合，避免普通 HTTP 改动触发整套 Skills
文档。任一规则命中后必须在同一 diff 更新使用指南、用户配置、developer API、系统架构和产品状态；
backend 阶段也要明确 UI/runtime 尚不可用，不能等到后续桌面任务再首次补文档。修改 impact mapping 本身
会命中 `documentation-contracts`，因此必须同步本文和贡献指南，说明新增 pattern、必需文档与本地验证方式。

纯内部重构可以豁免，但 PR body 最多只能有一个机器可读声明：

```html
<!-- docs-impact: {"version":1,"exemptions":[{"rule":"provider-config","reason":"只调整内部缓存实现，不改变 provider 配置、运行时选择或用户行为"}]} -->
```

豁免必须引用当前 diff 实际命中的 rule，理由去除空白后至少 20 个字符。PR 作者填写理由不等于获得豁免；有 write 权限的维护者评审后还要添加 `docs-impact-approved` label，可信门禁才会接受。该批准只绑定触发 label 的当前 PR head；后续 push 或编辑 PR body 都会让可信状态失败，必须先移除再重新添加 label。未知规则、重复豁免、空泛理由、多个声明或无效 JSON 都会失败。Route inventory、链接和 schema 错误不能豁免。

`.github/workflows/docs-gate.yml` 通过 `pull_request_target` 使用目标分支中的 checker 和影响映射，检查事件中精确的 PR head，不安装依赖或执行 PR 提供的脚本。workflow 的仓库内容权限只读，额外的 `statuses: write` 只用于把 `trusted-docs` 结果发布到精确的 PR head SHA；runner 自身的 check 不作为 required check。同一 PR 的事件使用 concurrency 串行收敛并取消旧 run，避免旧批准覆盖新的失败状态。`.github/CODEOWNERS` 保护 checker、contracts、workflow 和 agent 规则；仓库还必须把 commit status `trusted-docs` 配为 required check，并开启 Code Owner review，门禁才形成外部强制约束。

本地 diff 检查至少指定维护者给出的 base；只有确实需要受审豁免时才附 declaration 文件。它分别比较
merge-base 到 Git index、Git index 到工作树，再并入未跟踪文件；因此暂存改动即使被工作树反向覆盖也
不会消失。二进制变更（如截图基线 PNG）不会让检查崩溃：changed-line 提取按有损 UTF-8 解码，无效
字节替换为占位符，其中的 ASCII 内容仍参与 `changedLinePattern` 匹配，二进制无法绕过规则：

```bash
pnpm docs:check -- --base <base-sha>
pnpm docs:check -- --base <base-sha> --declaration <json-file>
```

## Agent 规则只有一个内容源

`AGENTS.md` 是仓库规则源，`CLAUDE.md` 是指向 `AGENTS.md` 的 Git symlink。修改规则时只编辑 `AGENTS.md`。

Windows checkout 需要在 clone 前开启 Developer Mode，或使用管理员权限，并设置：

```bash
git config --global core.symlinks true
```

已经把 symlink 物化为普通文件的 checkout 应在启用后重新 clone。首版不提供复制文件 fallback，因为复制会重新产生两份内容源。文档检查同时验证 Git index 的 `120000` mode 和工作树中的真实 symlink。

## Definition of Done

功能只有同时满足以下条件才能关闭：

- 测试先行，代码和相关测试通过。
- 受影响的 user/developer 文档已更新。
- 能力、P0/P1 或发布门槛变化已同步到 status 和 issue。
- API、配置、数据库、权限和发布契约通过对应检查。
- 活跃 spec/plan 的进度和 Deviation 已同步。
- UI 变化完成 Electron 截图和视觉差异裁决。
- `pnpm verify` 通过。
- 关闭的 spec/plan 已写 closeout、移出活跃索引并归档。

文档、测试或实现任一项仍与当前行为冲突，任务保持 active。
