---
type: plan
record_id: PLAN-DOC-LIFECYCLE-001
status: archived
source_spec_id: SPEC-DOC-LIFECYCLE-001
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

# 文档生命周期与开发门禁实施计划

## 目标

把当前审计结果、文档职责和开发门禁写进仓库，并让代码/API 变化缺少对应文档时在本地和 PR CI 中失败。`AGENTS.md` 成为唯一 agent 规则源，`CLAUDE.md` 改为软链；已完成的 Superpowers 资料补齐执行结果后归档。

## 约束

- 不引入新依赖，不新增文档框架或 OpenAPI。
- 历史 internal 正文保持原样，只补索引和新归档文档的结构化元数据。
- 检查器只实现已批准规格中的确定性规则；自然语言是否准确仍由评审负责。
- 代码修改使用测试驱动，先写失败 fixture，再实现检查器。
- 未经用户要求不提交、不推送。

## Task 1：建立文档检查器的测试骨架

**文件**

- 新增 `scripts/docs-check-lib.mjs`
- 新增 `scripts/docs-check.mjs`
- 新增 `scripts/docs-check.test.mjs`
- 删除旧的 desktop-only 文档引用测试（原路径 apps/desktop/scripts/docs-references.test.ts）
- 修改 `package.json`

**步骤**

- [x] 为 Markdown 链接和 heading fragment 写正反 fixture。
- [x] 为源码路径、symbol anchor 和禁止 `path:line` 写正反 fixture。
- [x] 为 front matter、稳定 ID、活跃索引和归档 outcome 写正反 fixture。
- [x] 为 route inventory 集合全等写新增、删除、重复和动态路由 fixture。
- [x] 为 docs-impact 多规则命中、豁免、重复声明和 POSIX 路径归一化写 fixture。
- [x] 为 Git index/工作树软链和 legacy baseline 只读规则写 fixture。
- [x] 删除旧的 desktop-only 文档引用测试，避免两套规则并存；根 `pnpm test` 显式运行新测试。
- [x] 先运行 `node --test scripts/docs-check.test.mjs`，确认失败原因来自未实现接口。

## Task 2：实现静态文档与 API 契约检查

**文件**

- 修改 `scripts/docs-check-lib.mjs`
- 修改 `scripts/docs-check.mjs`
- 新增 `docs/contracts/docs-impact.json`
- 新增 `docs/contracts/superpowers-migration-baseline.json`

**步骤**

- [x] 实现当前文档范围枚举，排除 internal 历史正文。
- [x] 实现相对 Markdown 链接、heading fragment、源码路径和 symbol anchor 检查。
- [x] 实现受控 YAML front matter 解析、稳定 ID、状态、索引和归档引用检查。
- [x] 从 `apps/pi-server/src/app.ts` 提取静态 Hono 路由，与 `api.md` 标记区间做集合全等比较。
- [x] 校验根 `pnpm <script>` 引用存在。
- [x] 校验 `CLAUDE.md` 的 Git index mode、blob target、工作树类型和 readlink target。
- [x] 让 fixture 测试通过。

## Task 3：实现 PR diff 文档影响检查

**文件**

- 修改 `scripts/docs-check-lib.mjs`
- 修改 `scripts/docs-check.mjs`
- 修改 `scripts/docs-check.test.mjs`

**步骤**

- [x] 实现 `--base`、`--declaration` 和 `--github-event` 参数。
- [x] 用 merge-base 到 HEAD 的 diff 作为变更集合，并统一 POSIX 路径。
- [x] 按 `docs-impact.json` 计算命中规则和缺少的 `requireAll` 文档。
- [x] 安全解析唯一的 `docs-impact` JSON 注释，严格校验 rule 和 reason。
- [x] 用 base/HEAD 的稳定 ID 验证 Superpowers 状态转换。
- [x] 覆盖受限的 `same_change` 新建后关闭规则，拒绝将其用于 base 已存在的记录。
- [x] 用 exact path 和 SHA-256 验证首轮 legacy 迁移，拒绝 baseline 后续改写或新增。
- [x] 让多规则、豁免、重命名和迁移 fixture 通过。

## Task 4：保存当前产品状态与发布问题

**文件**

- 新增 `docs/product/status.md`
- 新增 `docs/developer/issues/2026-07-11-product-readiness-audit.md`
- 修改 `docs/developer/issues/README.md`
- 修改 `docs/README.md`
- 修改 `docs/developer/README.md`

**步骤**

- [x] 写入 Alpha、NO-GO、验证 commit、下一里程碑和状态定义。
- [x] 写入稳定 capability ID、状态、发布门槛、边界、证据和目标。
- [x] 写入已确认的 P0/P1 摘要和详细证据，不使用完成百分比。
- [x] 记录 2026-07-11 的测试、类型、lint、格式、构建和视觉基线结果。
- [x] 更新文档入口和 issue 索引。

## Task 5：写入文档生命周期与开发规范

**文件**

- 新增 `docs/developer/documentation-lifecycle.md`
- 新增 `docs/superpowers/README.md`
- 修改 `docs/developer/contributing.md`
- 修改 `docs/developer/development.md`
- 修改 `docs/developer/build-and-release.md`
- 修改 `docs/internal/README.md`

**步骤**

- [x] 明确各类文档职责、状态定义和 Definition of Done。
- [x] 写清 Superpowers 创建、实施、偏差、closeout 和归档流程。
- [x] 写清 docs-impact 映射、机器豁免、route inventory 与本地命令。
- [x] 记录 Windows 软链前置条件和失败恢复方式。
- [x] 统一本地、贡献和发布文档中的验证命令。

## Task 6：纠正正式行为文档和 API 清单

**文件**

- 修改 `README.md`
- 修改 `docs/user/guide.md`
- 修改 `docs/user/configuration.md`
- 修改 `docs/user/README.md`
- 修改 `docs/user/concepts.md`
- 修改 `docs/developer/api.md`
- 修改 `docs/developer/architecture.md`

**步骤**

- [x] 删除“Ask 会逐条批准所有命令和文件变更”等超出实现的承诺。
- [x] 明确当前 API key、workspace 边界、文档上下文和 provider test 的实际限制。
- [x] 增加唯一 route inventory 标记区间，补上 PUT 文件写接口。
- [x] 把未实现的 branch endpoint 保留在 inventory 之外并标为 client-only gap。
- [x] 修正文档引用规范冲突，不再使用可漂移行号。

## Task 7：归档已完成的 Superpowers 执行资料

**文件**

- 移动并修改 `docs/internal/plans/2026-07-08-approval-backbone.md`
- 移动并修改 `docs/internal/plans/2026-07-10-message-stream.md`
- 修改 `docs/superpowers/specs/2026-07-08-p1-chat-core-experience-design.md`
- 修改 `docs/superpowers/README.md`
- 修改 `docs/internal/README.md`

**步骤**

- [x] 为 legacy 文件分配稳定 ID，并与 migration baseline 的 hash 对齐。
- [x] 按提交和测试写 `Implementation Outcome`，记录已完成、偏差、未完成项和遗留 issue。
- [x] approval backbone plan 以 `outcome: completed` 归档；该结果只表示计划执行完成，不解除 readiness audit 中的安全阻断。
- [x] message stream plan 已完成 Task 1–11、未执行 Task 12–15，以 `outcome: cancelled` 归档并把剩余项转入 readiness issue。
- [x] P1 chat-core spec 补稳定 ID 和当前进度后继续保持 active，因为第 3/4 节及整体验收尚未完成。
- [x] 更新两个索引；本次执行 closeout 后，活跃目录保留仍未完成的 P1 chat-core spec。

## Task 8：收敛 agent 规则并接入 CI

**文件**

- 新增 `AGENTS.md`
- 将 `CLAUDE.md` 改为指向 `AGENTS.md` 的软链
- 新增 `.github/pull_request_template.md`
- 新增 `.github/workflows/ci.yml`
- 新增 `.github/workflows/docs-gate.yml`
- 新增 `.github/CODEOWNERS`
- 修改 `package.json`

**步骤**

- [x] 把现有规则迁入 `AGENTS.md`，改为只引用 `pnpm verify` 和文档生命周期规范。
- [x] 移除不存在的 `RTK.md` 引用，不创建无职责文件。
- [x] PR 模板加入唯一机器可读 docs-impact 注释和人工检查项。
- [x] PR CI 在 Ubuntu、Node 22、pnpm 9.15.4 上运行静态 `pnpm verify`。
- [x] PR 额外运行带 base 和 GitHub event 的 diff 文档检查；push 不运行 diff 检查。
- [x] 可信 gate 从目标分支读取 checker/policy，豁免需要维护者 label；CODEOWNERS 保护门禁文件。

## Task 9：全量验证与 closeout

**步骤**

- [x] 运行 `pnpm docs:check`。
- [x] 运行 `node --test scripts/docs-check.test.mjs`。
- [x] 运行 `pnpm verify`。
- [x] 模拟漏改 API 文档和高信号文档，确认检查器给出可执行错误。
- [x] 使用 `check` skill 做 deep review，修复安全、架构和文档准确性问题。
- [x] 更新本 plan 的 `Implementation Outcome`，归档本 spec/plan，并更新索引。
- [x] 再次运行 `pnpm verify`，确认归档后的最终树通过。

## Implementation Outcome

- 实际完成：Task 1–9 全部执行，统一文档检查器、影响矩阵、状态快照、正式文档修正、历史迁移、agent 规则和 CI gate 已落入工作树。
- 测试实现：新增 27 项 docs-check 测试，覆盖链接、源码引用、路由集合、状态 schema、两段 Git diff、豁免、归档迁移、symlink 和不可信输入。
- 文档迁移：两个 legacy plan 已写实际 outcome 并归档，两份历史 handoff 移入 `docs/internal/handoffs/`，活跃区仅保留未完成记录。
- 未完成或取消：没有遗留的仓库内实施任务；形成 commit、配置 branch protection/required status 和在真实 PR 验证 gate 需要维护者后续执行。
- 与 spec 的偏差：按已记录决定增加受限 `same_change`、可信目标分支 gate、精确 head status、fresh approval 和 per-PR concurrency。
- 深度审查：初轮 security、architecture、docs accuracy 与 adversarial hard stop 已修复；2026-07-12 staged 复审又修复 same-change 归档自锁，并记录仍待处理的路由提取、影响映射、可信状态时效和 lifecycle index/worktree 问题。
- 故障注入：模拟缺失 API 文档、高信号代码缺少正式文档、动态路由、二进制 diff、staged/worktree 抵消和旧 label 复用，检查器均按预期失败。
- 验证：`node --test scripts/docs-check.test.mjs` 27 项通过，`pnpm docs:check -- --base HEAD` 与最终 `pnpm verify` 通过；总计 449 项测试通过，1 项 MiniMax live test 跳过。
- 正式文档：已更新 `docs/product/status.md`、`docs/user/`、`docs/developer/`、README、PR 模板和历史索引。
- 实现引用：实现与归档属于同一未提交变更，front matter 使用 `same_change: true` 且 `implementation_refs` 包含 `same_change`。
- 遗留 issue：`P1-DOCS-001` 保持 in-progress，直到 staged 深审阻断关闭、治理变更合入目标分支并完成 GitHub 仓库侧强制配置。
