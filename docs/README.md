# 文档索引

Marginalia 的文档。项目总览见仓库根目录的 [README](../README.md)。

## 按读者分流

**当前状态**

- [产品状态](./product/status.md) — 能力快照、发布决定、P0/P1 摘要和验证基线。

**使用用户**

- [用户文档](./user/) — 使用流程、provider 配置、文件上下文、权限、存储位置和故障排查。

**协作开发者**

- [开发者文档](./developer/) — 架构、API、本地开发、打包发布、测试验证和贡献规范。
- [活跃 Superpowers 文档](./superpowers/README.md) — 当前 spec、plan 和进度，不保存已关闭记录。

## 推荐阅读顺序

使用者：根 README → [用户文档](./user/) → [使用指南](./user/guide.md) → [配置](./user/configuration.md)。

新贡献者：根 README → [产品状态](./product/status.md) → [开发者文档](./developer/) → [系统架构](./developer/architecture.md) → [本地开发指南](./developer/development.md) → [文档生命周期](./developer/documentation-lifecycle.md)。

## 维护规则

- 根 README 只保存稳定产品介绍、快速开始和导航。
- `docs/product/status.md` 是能力状态、发布阻断和验证快照的唯一事实源。
- `docs/user/` 和 `docs/developer/` 描述当前契约，行为变化必须在同一改动中同步。
- `docs/superpowers/` 只保存活跃设计和计划；关闭后写 outcome 并移入 `docs/internal/`。
- `AGENTS.md` 是 agent 规则的唯一内容源，`CLAUDE.md` 通过 symlink 指向它。

完整流程见[文档生命周期](./developer/documentation-lifecycle.md)。

---

内部设计稿与历史 specs/plans 归档在 [`docs/internal/`](./internal/)，仅作背景参考，不代表当前实现。具体问题和修复验收见 [developer issues](./developer/issues/)。
