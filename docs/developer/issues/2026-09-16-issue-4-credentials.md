# Issue #4：系统凭据实施记录

- 来源：[Issue #4](https://github.com/sufe-debt-lab/marginalia/issues/4)，父规格 [#2](https://github.com/sufe-debt-lab/marginalia/issues/2)。
- 状态：in-progress（实现及本机验收完成，跨平台发布验收未执行）；last_verified：2026-09-16；目标：M0-trustworthy-local-alpha。
- 起点：`origin/main` 的 `0105cbf`；worktree：`marginalia-issue-4`，分支：`codex/issue-4-credential-store`。
- 前置核查：Issue 和父规格评论均为空；原生 blocked_by 为空；本票 blocking 为 #7、#19。
- 父规格相关合同：Implementation Decisions §1、§6、保留通用扩展合同和旧规格 Secret 所有权；Testing Decisions 的 Credential Store、HTTP/SSE、Electron 边界。
- 当前集成分支未包含 #3；#3 不是本票原生阻塞，不擅自合并或实现。主工作区未提交原型/文档改动保持不变。
- 没有既有 #4 实施计划；本记录追踪本票进度，既有 Skills 计划的任务范围不变。

## 实施步骤

- [x] 核查 Issue 全文/评论、父规格和原生依赖，核对既有代码。
- [x] Credential Store 合同先红后绿：保存、读取、替换、删除、缺失、拒绝访问、诊断脱敏。
- [x] Provider 新建只落引用；SQLite/WAL 迁移先回读再清理，失败重试。
- [x] Provider 生命周期、受控 Run 和真实 pi Session 持久化的错误脱敏。
- [x] 正式配置、用户恢复、API、架构、产品状态和发布说明同步。
- [x] focused tests、typecheck、完整 verify 与 Electron 交互/视觉验证。
- [x] packaged 系统适配器 smoke：macOS arm64 通过，其他平台明确列为未验证。
- [x] Standards / Spec 独立审查与修复；两轴复查均无未解决发现。

## 已获得的验证证据

合同测试首先因缺少 Credential Store 失败；新建、迁移、缺失 key、锁定恢复和模型错误测试
分别复现旧行为后转绿。真实 pi streamFn 的合成错误在修改前进入 Session 历史，修改后不再泄露。
最终结果如下；未执行的平台检查不计为通过。

## 范围与偏差

- UI 仅增加中英文凭据恢复错误提示，不改布局，不引入原型模拟数据，不改 HTTP/SSE 形状或文档正文所有权。
- 保留现有 env_vars 外键行但清空 value，避免重建 Provider/Run 表。
- 系统库与 SQLite 没有跨系统原子事务；同步失败有补偿，进程崩溃可能留下孤立系统项或缺失 key，必须如实报告并修复。
- 不读取旧手工 auth.json；其历史副本/备份不自动删除。
- 不提交、推送、创建 PR 或关闭 Issue。

## 审查修复

- Standards P2：凭据错误码未经本地化显示。新增双语恢复提示并在 Provider Test/诊断/CRUD、聊天接受前与终态提示复用；组件测试先红后绿。
- Spec P2：清空后才做 WAL/VACUUM 会在失败时丢失数据库源值。真实第二连接 WAL reader 测试复现后，调整为先完成可失败清理，最后 secure_delete 事务原子提交源值清除和 v4 标记；失败仍保留源值。
- React best-practices 检查：仅显示时派生翻译，不新增 state/effect、订阅、请求或依赖。

## Implementation Outcome

本票实现和本机验收完成。GitHub Issue 保持打开，未提交、推送或创建 PR；跨平台/签名身份发布
验证仍需对应环境。没有实现 #3/#5 或后续 CapabilityManager，主工作区的原型和未提交修改未动。

| 验收条件                     | 结果和证据                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Credential Store 外部行为    | 5 项合同测试，覆盖两类 owner、CRUD、缺失、拒绝和无 cause 的脱敏失败                                                                      |
| 旧值一次迁移与失败恢复       | 临时 SQLite/WAL、真实 WAL reader 锁、失败后源值和标记、释放后重试                                                                        |
| 数据库只存引用               | 新建及迁移后的数据库/WAL 文件字节扫描无合成 secret；空 legacy 元数据行保留外键                                                           |
| Provider 生命周期及 Run      | HTTP 创建/修改/禁用/启用/删除、SQL 拒绝补偿、真实数据库重开、受控 Agent 与缺失后修复重试                                                 |
| 不向会话/错误等泄露          | 无 argv/env 注入；AuthStorage 内存；真实 pi SessionManager 文件及 SSE/Run 错误检查；无安装 receipt 实现                                  |
| 内存 Adapter 与平台 smoke    | 普通 Vitest/隔离 Electron 使用内存；macOS arm64 实际 packaged Resources 的 Electron utilityProcess 原生 smoke 通过；Windows/Linux 未实测 |
| Knowledge Platform 共用 seam | 同一个 CredentialStore/OS service，合同测试使用 provider 与 knowledge-platform owner；未提前实现后续安装功能                             |
| 文档和验证                   | 配置、用户指南、API、架构、开发/发布、产品状态和本记录同步；下列命令通过                                                                 |

### 验证结果

- focused server：7 files / 88 tests passed；desktop：3 files / 41 tests passed。
- `pnpm verify`：exit 0，包含 docs、format、lint、全部包 typecheck、tests 和 build。
  Vitest 合计 797 passed：chat-core 38、pi-server 311、desktop 448；1 项显式真实模型 smoke skipped。
- `pnpm docs:check -- --base 0105cbf`：static + diff passed。
- `pnpm --filter @marginalia/desktop package`：macOS arm64 成功，native store 已恢复 system Node ABI。
- `pnpm --filter @marginalia/desktop exec electron scripts/credential-packaged-smoke.mjs`：darwin/arm64 passed。
  使用独立 namespace 的合成条目，跨子进程保存/读取/替换/删除/缺失；本次及调试条目均已清理。
- `pnpm verify:visual`：exit 0，40 张截图；37 unchanged、3 changed、0 new/orphan/error。
  实际 Electron 操作覆盖 Provider 添加/编辑/启停/删除确认、真实 HTTP 空 key 的 Test 错误及恢复，
  并回归工作区、附件、审批和 Skills。新增凭据恢复提示基线仅在目视检查后添加。

### 逐张视觉裁决

| 图片                                | diff           | 裁决                                                                         |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| core-ui/provider-credential-missing | 新增后纳入基线 | 有意新增恢复提示。toast 可读、无遮挡、无敏感值，保留现有布局                 |
| skills-flow/skills-settings         | 0.295%         | 新 worktree 的绝对路径文本不同；与旧基线逐张对照，无本票布局回归，不改旧基线 |
| skills-flow/skills-global-only      | 0.252%         | 全局 fixture 的绝对路径不同；内容/控件正常，不改旧基线                       |
| skills-flow/skill-diagnostics       | 0.252%         | fixture 路径文字不同；诊断与预览正常，不改旧基线                             |

视觉报告位于本地 `output/visual-diff/report.md`，本次运行 PNG 位于
`output/desktop-screenshots/`。它们是运行产物，只有有意新增的凭据恢复截图纳入版本管理。

### 剩余与未验证

- Windows/Linux 的 OS store smoke 未在本机执行；macOS/Windows 打包 workflow 已接入 gate，未推送也未运行远端 CI。
- 未执行签名/公证后应用身份的权限提示验收；当前证据是实际 packaged Resources 在 Electron utilityProcess 中运行。
- 未调用真实外部模型、读取真实 Provider key 或修改开发者已有凭据。真实推理不是本票确定性验证的证明来源。
- 系统库/SQLite 同步失败有补偿，但跨系统崩溃不保证事务原子性；旧备份/快照/转储不擦除。
- P0-SEC-006 总安全 gate 仍 open，renderer sandbox 不属于本票交付内容。

## Review 后续修复（2026-09-16）

本节追加记录后续审查发现和修复证据，前面的 Implementation Outcome 是初次实现的验证快照。

- [x] P1 探测污染活跃凭据：Test 仅读取所选凭据并检查 `getAll()` 模型注册，不修改共享 AuthStorage。
      受控 Run 的两次真实 ModelRegistry 凭据读取之间，分别探测停用和缺失 key 的第二账户；旧代码返回 A/B 或 A/undefined，修复后均为 A/A。
- [x] P1 截图 flag 导致旧 key 丢失：截图模式将 SQLite 与 credential Adapter 同时置于进程内存，
      不打开默认数据库且忽略显式数据库路径。实际 src/index 启动回归覆盖两种路径和两次启动；原文件字节完全不变。
- [x] P2 迁移遗漏孤立 key：legacy env_vars 的所有未迁移记录均纳入系统库，保留引用后清空明文；
      不通过删除孤立值掩盖问题。回归包含旧创建第二次 INSERT 的 NOT NULL 失败、已有 v4 标记、拒绝读取后的重试和 SQLite/WAL 字节检查。
- [x] 完整 verify、Electron 场景及视觉裁决、独立复查完成，结果如下。

修复没有新增协议、状态系统或系统凭据实现。截图模式的两种存储保持同一进程生命周期，避免新增测试路径守卫、环境认证或临时数据库命名规则。

复查补充：Run 原先在占用检查前修改 runtime key，同类问题可由被拒绝的请求触发。
已将注册移到全部预检成功且即将 start 的位置，缺失分支不再清除共享 key；
`busy-run`、`missing-run`、另一 Session 的 `invalid-skills` 三项回归先红后绿。

### 修复后的验证结果

- focused Provider 回归：58 tests passed；截图真实启动隔离与启动环境：4 tests passed；pi-server typecheck passed。
- 最终 `pnpm verify` exit 0：Vitest 807 passed（pi-server 321、desktop 448、chat-core 38），1 项真实模型 smoke skipped；文档、格式、lint、所有包 typecheck 和 build 通过。
- `pnpm verify:visual` exit 0：实际 Electron 的 Provider、工作区、审批和 Skills 场景完成，40 张截图中 37 unchanged、3 changed、0 new/orphan/error。
- 逐张对照当前图、基线和差异图：`skills-settings`（0.296%）、`skills-global-only`（0.250%）、`skill-diagnostics`（0.251%）的主要差异均为 worktree/fixture 绝对路径文字；另有列表 hover 状态差异。布局、诊断与预览正常，无本次修复回归，不更新基线。
- Spec 与设计独立复查完成；设计复查发现的拒绝 Run 副作用已用新增回归复现并修复，复查无剩余实质发现。
- 未新增平台打包验证；上文 Windows/Linux 和签名应用身份的未验证限制继续适用。未提交、推送或关闭 Issue。

## PR 前最终复查（2026-09-16）

用户随后授权在最终复查通过后提交并创建 PR，替代上述阶段的“不提交/推送”限制，Issue 仍保持打开。
重新读取 Issue #4/#2 与原生阻塞关系，远端 main 仍为 `0105cbf`，没有新增前置。
需求与代码设计两路独立复查均无阻塞发现；主审核实调用链、改动范围与验证记录。
修正开发文档中截图 runner 仍设置磁盘数据库路径的旧描述；代码未再变更，沿用上一节完整验证与逐张视觉裁决结果。

## PR #35 review 与主干合并

两条 review 均有效：异步准备期间 Settings 可更新凭据，旧快照在 start 前写回会撤销更新；用户指南仍保留 SQLite 明文和磁盘 AuthStorage 的旧声明。
修复在实际模型 start 前同步重新读取权威凭据；清空/拒绝访问沿用已接受 Run 的失败与清理路径，不新增版本锁或状态系统。
受控 prepare 暂停期间经真实 PATCH 替换/清空 key，两个回归在旧代码均读到 old-key 而失败，再修复实现。
合并 main `950f732` 的面板功能，冲突仅为翻译键与文档追加章节，保留双方意图。双方内容均已保留。

验证：`pnpm verify` exit 0，817 tests passed（server 323、desktop 456、chat-core 38），1 项真实模型 smoke skipped；两个新增测试先红后绿。最新 main 的 docs diff check 和 git diff check 通过。
`pnpm verify:visual` exit 0，43 张图中 39 unchanged、4 changed。逐张裁决：凭据缺失提示图（1.925%）继承主干 275px 侧栏/46px 顶栏，toast 正常，使用带 reason 的比较命令更新这一张基线；Skills settings/global-only/diagnostics（0.234%/0.189%/0.222%）仅路径文本变化，不更新。新增主干面板交互场景通过。
