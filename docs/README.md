# 文档索引

Marginalia 的文档。项目总览见仓库根目录的 [README](../README.md)。

## 按读者分流

**使用用户**

- [用户文档](./user/) — 使用流程、provider 配置、文件上下文、权限、存储位置和故障排查。

**协作开发者**

- [开发者文档](./developer/) — 架构、API、本地开发、打包发布、测试验证和贡献规范。

## 推荐阅读顺序

使用者：根 README → [用户文档](./user/) → [使用指南](./user/guide.md) → [配置](./user/configuration.md)。

新贡献者：根 README → [开发者文档](./developer/) → [系统架构](./developer/architecture.md) → [本地开发指南](./developer/development.md)。

## 维护规则

- 面向用户的功能、配置、存储、隐私边界或故障排查变化，要同步更新根 README 和 `docs/user/`。
- API、进程模型、消息形状、打包/runtime、验证命令或协作规则变化，要同步更新 `docs/developer/`，并在必要时更新 [CLAUDE.md](../CLAUDE.md)。
- `docs/internal/` 是历史归档；从 internal 提取仍有效的规则时，要提升到顶层 docs 或 `CLAUDE.md`。

---

内部设计稿与历史 specs/plans 归档在 [`docs/internal/`](./internal/)，仅作背景参考，不代表当前实现。
