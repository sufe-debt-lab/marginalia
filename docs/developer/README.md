# 开发者文档

这些文档面向协作开发者，重点是代码结构、运行机制、验证方式和贡献规范。

开始开发前先看[产品状态](../product/status.md)。当前发布决定是 NO-GO，详细阻断见[产品就绪审计](./issues/2026-07-11-product-readiness-audit.md)。

## 文档

- [系统架构](./architecture.md) — 进程模型、启动流程、请求数据流、单一事实源约定。
- [本地开发指南](./development.md) — 环境、安装、命令、代码约定、commit gate。
- [API 参考](./api.md) — pi-server HTTP 路由、SSE 事件格式和数据模型。
- [打包与发布](./build-and-release.md) — 打包流水线、原生模块 ABI 处理、CI、平台产物。
- [贡献指南](./contributing.md) — 分支、提交、PR 规范。
- [文档生命周期](./documentation-lifecycle.md) — 文档权威边界、docs impact、Superpowers closeout 和 Definition of Done。
- [Issue notes](./issues/) — 当前 review/backlog 问题记录。

## 推荐阅读顺序

新贡献者：根 README → [产品状态](../product/status.md) → [系统架构](./architecture.md) → [本地开发指南](./development.md) → [文档生命周期](./documentation-lifecycle.md)。

改接口、消息流、打包或验证流程时，同步查 [API 参考](./api.md)、[打包与发布](./build-and-release.md)、[贡献指南](./contributing.md)和[文档生命周期](./documentation-lifecycle.md)。
