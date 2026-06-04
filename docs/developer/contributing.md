# 贡献指南

欢迎为 Marginalia 贡献代码。开始前请先读[本地开发指南](./development.md)和[系统架构](./architecture.md)。

## 分支策略

- 从 `main` 切分支开发，**不要直接提交到 `main`**。
- 提交/推送/开 PR 在被要求或确认后进行。

## 提交信息

使用 **Conventional Commits**，并带上包 scope：

```
feat(desktop): …
fix(pi-server): …
refactor(chat-core): …
chore(desktop): …
polish(desktop): …
```

## 提交前检查（commit gate）

每次提交前务必：

1. **TDD**：先写/调整测试，看它失败，再实现到绿。
2. 跑改动所在包的 `typecheck` + 相关 `test` 并确认通过：

   ```bash
   pnpm --filter @marginalia/<pkg> typecheck
   pnpm --filter @marginalia/<pkg> test
   ```

3. **UI 改动**：用 **Electron 截图**验证（`pnpm verify:screenshots`）——浏览器打开 Vite 页面不算数。
4. 用户可见功能、API、配置、存储、打包/runtime、验证命令或协作规则变化时，同步更新相关文档。

改动范围较大时，补跑根级检查：

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

## 代码约定速查

完整说明见[本地开发指南 · 代码约定](./development.md#代码约定)，要点：

- 导入用 `.js` 扩展名（即使源文件是 `.ts`/`.tsx`）。
- 跨目录导入用 `@/` 别名（→ `apps/desktop/src/`）。
- 面向用户的字符串走 `t()`，并同时补 `messages.ts` 的 `en` + `zh`。
- 用设计 token（mono + serif + emerald），不写临时颜色。
- 聊天消息保持 pi 原生形状，不引入扁平化 UI 类型。
- 文档引用源码用 `path` 或 `path#符号`，不用 `path:line`（守卫测试会校验，详见[开发指南 · 代码约定](./development.md#代码约定)）。

## PR

- 一个 PR 聚焦一个闭环改动；保持 diff 可审阅。
- 描述里说明动机、改动点、如何验证（命令 / 截图）。
- 描述里写清本地验证结果。当前 GitHub workflow 主要覆盖 tag/manual 的桌面打包，不等同于每个 PR 都有完整 CI gate。

## 相关文档

- [本地开发指南](./development.md)
- [系统架构](./architecture.md)
- [打包与发布](./build-and-release.md)
