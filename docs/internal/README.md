# Internal 文档归档

`docs/internal/` 保存历史设计、执行计划、路线图素材和设计资产。这里的内容只作背景参考，不代表当前实现，也不是新的开发入口。

当前代码事实以源码、根 [README](../../README.md)、[文档索引](../README.md)、[系统架构](../developer/architecture.md)、[API 参考](../developer/api.md) 和 [CLAUDE.md](../../CLAUDE.md) 为准。

## 目录说明

| 目录 | 用途 | 可信度 |
| --- | --- | --- |
| `plans/` | 历史执行计划和 handoff 记录 | historical execution records，可能包含已删除文件、旧命令和过期方案。 |
| `specs/marginalia/` | 渐进式产品 spec | 00-04 的部分内容已进入当前实现；05-10 多数仍是 planned/not implemented。 |
| `specs/*.md` | 大规格、UI 重做、设计对齐说明 | historical/design reference，不能直接当作当前 roadmap。 |
| `specs/assets/` | 截图、HTML/JSX 原型、设计工具导出 | design reference，不是生产代码。 |

## 使用规则

- 新协作者优先阅读顶层 docs，不从 internal plans 开始。
- internal 与当前源码冲突时，以源码和顶层 docs 为准。
- 从 internal 提取仍有效的规则时，要同步写入顶层 docs 或 `CLAUDE.md`。
- 不要从用户向文档深链到 internal，除非明确说明它是历史背景。
