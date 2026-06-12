# 视觉回归 + 设计稿对比 loop · 设计

> 状态：草案（待 plan 展开）
> 作者：Claude（与 shixy 协作，经 Codex 两轮 review + 独立架构子代理交叉验证）
> 日期：2026-06-12
> 关联：`apps/desktop/scripts/verify-screenshots.mjs`（现有截图 harness）、`CLAUDE.md` commit gate 第 5 条、`.claude/skills/verify/`

## 背景

开发流程是「spec / Claude Design 设计稿（HTML/JSX 可渲染原型 + PNG 静态图）→ Claude Code 实现」。现有验证基础设施：

| 层            | 现状                                                                                                                                                                                                               | 缺口                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 单元/组件测试 | Vitest + jsdom + Testing Library，TDD 提交门                                                                                                                                                                       | 无                          |
| 截图验证      | `verify-screenshots.mjs`：Playwright `_electron` 驱动真实 Electron（1280×800、`force-device-scale-factor=1`、`data-motion=off`、隔离 db/HOME），场景化截图 + capture contract（label 齐全 + 合法 PNG）+ adhoc 模式 | **无图像内容比对**          |
| 回归判定      | Claude/人工肉眼看 `output/desktop-screenshots/`                                                                                                                                                                    | **无基线、无 pixel diff**   |
| 设计稿对比    | 设计稿 bundle 存于 docs，与截图流程零打通                                                                                                                                                                          | **无自动对比，无迭代 loop** |

要补的两件事：①现有功能的**基线视觉回归**；②新功能 vs 设计稿的**对比迭代 loop**，由 Claude 自主循环（实现 → 截图 → 比对 → 读图 → 改码）逼近设计稿还原。

## 目标

- 现有 UI 的视觉回归可自动检测：基线 PNG 入库，逐张 pixel diff，机器可读输出供 Claude 裁决。
- 新功能截图可与设计稿（PNG 或可渲染原型）比对，输出「设计稿｜实现｜diff」三联图 + 差异分数。
- 迭代 loop 固化为项目 skill，纳入 commit gate。
- 全部新依赖为纯 JS（`pixelmatch`、`pngjs`），不引入原生 ABI 风险。

## 非目标

- 不引入 Playwright `toHaveScreenshot` / BackstopJS / Lost Pixel 等框架（BackstopJS/Lost Pixel 驱动不了 Electron harness；`toHaveScreenshot` 不支持「任意外部设计稿 PNG vs 实现」的比对模型，且需迁移到 `@playwright/test` runner）。
- 像素分数不做硬性门控（设计稿模式分数只是趋势信号，见「设计稿模式」）。
- `minimax-live` 场景不进基线（真实 LLM 输出非确定）。
- 不做跨平台基线（单开发者 macOS；若未来上 Linux CI 再议基线平台策略）。
- 不上 Git LFS（初始基线 25 张、几 MB 量级）。

## 方案选型

三个候选经 Codex tradeoff review + 独立架构子代理交叉分析，结论一致选 **方案 B：捕获/比对分离** + 三个借来的集成点：

| 候选                                      | 结论                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A：diff 内建进 `verify-screenshots.mjs`   | 否。`--update-baseline` 绑在 capture 上意味着每次 bless 基线/调参重比都要全量重跑 Electron（1–3 分钟）；退出码把「harness 坏」和「像素漂移」混在一个语义上；940 行脚本（agent 编辑最频繁的文件）再膨胀 30%。其仅有优势（孤儿检测同文件、gate 一条命令）以近零成本借入 B。 |
| B：独立 `compare-screenshots.mjs`（选定） | 「重比不重拍」：bless、调阈值、换设计稿都是秒级文件操作；退出码天然二分；diff 异常不污染 capture manifest。                                                                                                                                                               |
| C：成熟视觉回归框架                       | 否。两个硬约束：驱动不了 Electron；不支持设计稿比对模型。唯一值得借的「连拍稳定」机制约 15 行可复刻。                                                                                                                                                                     |

借入的集成点：① capture 脚本导出 `SCENARIOS` 注册表供 compare import；② 聚合 npm script 串 capture+compare；③ capture 层连拍稳定重试（来自 C 的思路）。

## 设计

### 1. capture 层确定性加固（改 `verify-screenshots.mjs` + 渲染层）

review 确认的残留非确定源及对策（均在 `MARGINALIA_SCREENSHOT_VERIFY=1` 下生效）：

- **相对时间戳**（`RecentThreads` / 侧栏会话树的 `relativeTime(..., Date.now())`）：截图模式注入固定时钟（或 seed 固定 `updatedAt`），保证跨分钟/跨天重跑结果一致。
- **输入光标**：截图模式 CSS 注入 `caret-color: transparent`。
- **字体/动画 settle**：每张截图前等 `document.fonts.ready` + 一帧。
- **连拍稳定重试**：`capture()` 内连拍两张逐字节比对，不一致则等待重试（上限 3 次，仍不稳定则报错），从源头消灭 caret 闪烁与 Radix transition 噪声。

同时导出 `SCENARIOS`（含 `expected`、`live` 元数据）供 compare 脚本 import——`verify-screenshots.test.ts` 已有 import `.mjs` 导出的先例。

### 2. 新工具 `compare-screenshots.mjs` · 回归模式

`apps/desktop/scripts/compare-screenshots.mjs`，共享逻辑抽 `scripts/lib/image-diff.mjs`（pixelmatch + pngjs）。

- 读取 `output/desktop-screenshots/manifest.json`，按 `scenario/label` 解析本次截图（不依赖 `NN-` 序号前缀）。
- 与 `apps/desktop/screenshots-baseline/<scenario>/<label>.png` 逐张比对。**尺寸不一致 = 硬错误**，不静默 resize。
- 每张状态：`unchanged`（低于抗锯齿噪声阈值，初始 0.05%，可调）/ `changed`（输出 diff 图）/ `new`（无基线）/ `orphan`（基线存在但本次未捕获）。
- 孤儿判定用导入的 `SCENARIOS` 做全量视角：只跑 `--scenario core-ui` 时，seeded-workspace 的基线标为「本次未覆盖」而非孤儿；`live: true` 场景与 adhoc 目录始终排除。
- 输出 `output/visual-diff/report.json`（机器可读：每张的状态、diff 百分比、宽高、图路径）+ `report.md`（changed/new 排前，紧凑表格 + 缩略图链接完整图）。运行结束打印摘要行：`changed=N new=N unchanged=N orphan=N errors=N`。
- **退出码语义**：默认只在比对本身出错时非零（裁决权在读图者）；`--fail-on-diff` / `--max-diff-percent <n>` 留给未来 CI。
- `--update-baseline <scenario/label ...>`：仅按 scenario 或 label 粒度显式更新，禁止隐式全量；要求 `--reason "<简短理由>"`，理由写入 report 供 git review 对照。

### 3. `compare-screenshots.mjs` · 设计稿模式

`--design <path> --impl <scenario/label | png 路径>`：

- 设计稿输入类型显式三种：**PNG**（直接比，要求尺寸与实现截图一致）；**独立 HTML**（Playwright chromium 按实现截图实际尺寸 + `scale:"css"` 渲染）；**Vite serve 的原型入口**（URL）。JSX 原型需先有显式预渲染命令产出 HTML/PNG，compare 脚本不自行推断框架。
- 输出「设计稿｜实现｜diff」**三联横拼图** + 差异百分比，Claude 一次 Read 完成裁决。
- **定位写死为趋势信号**：Chromium 原型与 Electron 实现存在字体光栅化等本质渲染差异，像素分数只用于「本轮比上轮降即收敛」的趋势判断，达标与否由 Claude 读三联图按布局/间距/颜色 token 裁决，不追亚像素文字差异。
- 留口（本期不做）：若分数噪声实际干扰裁决，再给 `verify-screenshots.mjs` 加「在 Electron harness 内渲染原型」的 capture 模式，根治光栅化差异。

### 4. 基线管理

- 目录 `apps/desktop/screenshots-baseline/<scenario>/<label>.png`，初始由当前 main 截图生成并提交（core-ui 18 张 + seeded-workspace 7 张）。`output/` 在 `.gitignore` 中，基线目录在其外，report 产物不入库。
- 更新只能显式 `--update-baseline`，变更进 commit diff；Claude 对每张 `changed` 必须裁决「有意变更 / 意外回归 / 不确定」，**不确定默认不更新基线**。

### 5. Loop 协议（项目 skill）

新增 `.claude/skills/design-loop/SKILL.md`：

1. 读设计稿（PNG 或渲染原型）→ 实现代码。
2. `pnpm verify:screenshots -s <scenario>`（或 adhoc `--shot`）截取实现态。
3. 设计稿模式比对 → Read 三联图 + 差异分数。
4. 裁决：布局/间距/颜色 token 不一致 → 改码回到 2；分数只作趋势信号。
5. 达标后：新 UI 状态按现有规则扩展 scenario fixture，`--update-baseline --reason` 纳入回归基线。
6. 走现有 `verify` skill 收尾（typecheck / test / lint / i18n）。

更新 `.claude/skills/verify/SKILL.md` 第 4 步：UI 变更除截图外需跑回归比对，`changed` 项逐张裁决（有意 → 更新基线附理由；意外 → 修复；不确定 → 不更新并上报）。

### 6. 脚本接线

- `apps/desktop/package.json`：`compare:screenshots`（回归）、`compare:design`（设计稿模式）、聚合 `verify:visual` = capture && compare。
- root `package.json`：转发 `verify:visual`。
- commit gate（`CLAUDE.md` 第 5 条）措辞更新为跑 `pnpm verify:visual`。

## 测试策略（TDD）

均为 node 环境 Vitest，不起 Electron：

- `image-diff` 模块：程序化构造小 PNG，断言差异比例、diff 图输出、尺寸不一致抛错。
- compare 脚本：manifest 解析（label→文件映射、partial-run/orphan/live 排除）、参数解析（`--update-baseline` 粒度与 `--reason` 必填）、report.json 结构。
- capture 侧：`parseArgs`/导出契约测试扩展，连拍稳定逻辑的可测部分。
- manifest schema 契约测试钉住两脚本间 `{scenario, label, path}` 接口。

## 文档更新

- `docs/developer/development.md`：视觉回归 + 设计稿 loop 章节（命令、基线纪律、输入类型）。
- `CLAUDE.md`：commit gate 第 5 条。
- `docs/README.md` 索引如有需要。

## 新依赖

`pixelmatch`、`pngjs`（`apps/desktop` devDependencies，纯 JS，无原生 ABI 风险）。

## 风险与缓解

| 风险                               | 缓解                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| 设计稿模式像素分数失真（跨光栅器） | 定位写死为趋势信号 + Claude 读图裁决；留 Electron 内渲染原型的演进口          |
| 残留非确定性导致基线误报           | capture 层四项加固（时钟/caret/fonts.ready/连拍重试）先行落地，再生成初始基线 |
| 基线批量变更 review 不透明         | `--update-baseline` 强制粒度 + `--reason`；变更随分支进 git review            |
| 两脚本 manifest 契约漂移           | 契约测试钉住 schema；`SCENARIOS` 单一来源导出                                 |
| 退出码被未来 CI 误用               | 默认软报告语义文档化；CI 显式用 `--fail-on-diff`                              |
