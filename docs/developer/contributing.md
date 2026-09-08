# 贡献指南

开始前先读[产品状态](../product/status.md)、[本地开发指南](./development.md)、[系统架构](./architecture.md)和[文档生命周期](./documentation-lifecycle.md)。

## 分支与提交

从维护者指定的 PR base 或当前 integration branch 切分支。仓库当前没有 `main` ref，不在规则中假设固定主分支，也不直接向共享集成分支提交。

Commit、push 和创建 PR 只在用户明确要求或确认后执行。

提交使用 Conventional Commits：

```text
feat(desktop): ...
fix(pi-server): ...
refactor(chat-core): ...
docs: ...
chore(desktop): ...
```

代码变更使用清楚的 package scope；纯文档变更可以使用 `docs:`。

## 一个 PR 形成一个闭环

PR 应包含同一行为的测试、实现、正式文档和验证证据。不要把 user/developer 文档的首次更新留到另一个 PR，也不要把完成的 Superpowers plan 留在活跃目录。

开始实现时：

- 确认关联 spec 已 approved，并改成 active。
- Plan 通过稳定 `source_spec_id` 引用 spec。
- 在 `docs_impact` 声明可能变化的 user、developer 和 product status 文档。
- 实现偏离设计时先更新 spec 的 Deviation。

关闭时：

- 写 `Implementation Outcome`，记录完成内容、偏差、验证、正式文档和遗留 issue。
- 更新产品状态和 readiness issue 中发生变化的能力或问题。
- 从活跃索引移除，移动到 internal，并写 archived/outcome 元数据。

完整状态转换见[文档生命周期](./documentation-lifecycle.md)。

已经合入 `docs/internal/specs/` 或 `docs/internal/plans/` 的结构化归档按字节不可变；后续更正写入当前正式文档、issue 或新记录，不改写历史执行证据。

## 验证

改动所在包先完成 focused test 和 typecheck。提交前在仓库根运行：

```bash
pnpm verify
```

根级 `dev`、`test` 和 `typecheck` 会自行先构建 workspace library exports；验证结果不能依赖工作区中历史遗留的 `packages/chat-core/dist`。修改这些 lifecycle scripts 时，保留干净 checkout 的回归覆盖。

UI 改动另跑：

```bash
pnpm verify:visual
```

视觉报告中的每个 changed 都要明确裁决。默认视觉脚本可能在存在 changed 时返回 0，不能只看 exit code。

文档影响检查可以显式指定 base 和本地声明：

```bash
pnpm docs:check -- --base <base-sha>
pnpm docs:check -- --base <base-sha> --declaration <json-file>
```

没有豁免时运行第一条即可；只有确实属于内部重构且准备提交机器可读豁免时才使用 declaration。不要用
豁免代替缺失的正式文档更新。

diff 检查对二进制变更（如截图基线 PNG）安全：changed-line 提取使用有损 UTF-8 解码，二进制不会让检查崩溃，其中的 ASCII 内容仍会被 `changedLinePattern` 规则匹配到。

首轮 Superpowers legacy 迁移必须把 source path 与 SHA-256 固定在 migration baseline。只有源文件在当前 PR 历史中晚于 merge base 创建时，才额外填写完整 `sourceRevision`；它必须位于 merge base 与 HEAD 之间，不能用任意外部分支提交代替可信前态。

当前树检查在干净 CI 的构建步骤之前运行。正式文档可以描述 `dist`、`release`、`resources`、`output` 等生成目录；源码引用守卫会跳过这些目录，不依赖本地是否已经生成构建产物。修改这套识别规则时必须同步 `scripts/docs-check.test.mjs` 的干净工作区回归。

## Docs impact

PR 模板要求填写受影响的正式文档、产品状态、活跃 spec/plan 和验证结果。高信号代码路径由 `docs/contracts/docs-impact.json` 映射到必须更新的文档。

`skills-management` 规则覆盖 pi-server Skills catalog、prompt/history serialization、Pi runtime
injection、agent session cache，以及 desktop 的 `useSkillCatalog`/streaming hooks、Composer、Chat/New
chat、blocked repair、AppShell/Sidebar Settings composition、Settings 和 store 相关路径。
`skills-desktop-api` 与 `skills-route-composition` 分别以窄 changed-line pattern 补充覆盖 desktop client
中的 Skills DTO/调用和 `app.ts` 中的 Skills route、snapshot、runtime 与 canonical-root 组合。无论改动处于 backend 还是 UI
阶段，同一 diff 都要更新使用指南、用户配置、developer API、系统架构和产品状态，并准确区分“后端已实现”
和“用户工作流已可用”。修改 `docs/contracts/docs-impact.json` 本身
会命中 `documentation-contracts`，需要同步本文与文档生命周期，记录 pattern 和贡献者应运行的
diff-impact 命令。

纯内部重构可以声明豁免：

```html
<!-- docs-impact: {"version":1,"exemptions":[{"rule":"provider-config","reason":"只调整内部缓存实现，不改变 provider 配置、运行时选择或用户行为"}]} -->
```

一个 PR 最多出现一个 `docs-impact` 注释。Rule 必须是当前 diff 实际命中的规则，reason 去除空白后至少 20 个字符。理由由 PR 作者填写；有 write 权限的维护者确认后添加 `docs-impact-approved` label。批准绑定当时的 PR head，后续 push 或编辑 PR body 后必须移除并重新添加 label。API route inventory、失效链接和 schema 错误不能豁免。

仓库维护者需要把 `verify` 和 PR head 上的 `trusted-docs` commit status 配成 required checks，并启用 Code Owner review。`trusted-docs` 从目标分支读取 checker 和 policy，不信任 PR 对门禁实现的修改；`pull_request_target` runner 只用 `statuses: write` 把结果发布到精确 head SHA。门禁本身的变更由 `.github/CODEOWNERS` 指定维护者审批。

## Agent 规则 symlink

`AGENTS.md` 是唯一规则源，`CLAUDE.md` 必须是指向它的 Git symlink。不要复制两份内容。

Windows 贡献者在 clone 前开启 Developer Mode，或使用管理员权限，并执行：

```bash
git config --global core.symlinks true
```

如果现有 checkout 已将 `CLAUDE.md` 物化为普通文件，启用 symlink 后重新 clone。`pnpm docs:check` 会同时检查 Git index mode 和工作树 symlink。

## 代码约定

- TypeScript ESM import 使用 `.js` 后缀。
- Desktop 跨目录 import 优先使用 `@/`。
- 用户可见字符串走 `t()`，同时补齐英文和中文消息。
- 使用现有设计 token，不添加临时颜色。
- 聊天消息保持 pi 原生形状，不创建平行 UI schema。
- 正式文档引用源码时使用 `path` 或 `path#symbol`，不使用 `path:line`。

## PR 描述

描述中写清：

- 为什么改；
- 用户和工程行为发生了什么变化；
- 更新了哪些正式文档；
- 产品状态和 Superpowers 生命周期是否变化；
- 运行了哪些命令，结果如何；
- UI 截图和视觉差异如何裁决；
- 剩余风险和后续 issue。

## 相关文档

- [本地开发指南](./development.md)
- [文档生命周期](./documentation-lifecycle.md)
- [API 参考](./api.md)
- [打包与发布](./build-and-release.md)
