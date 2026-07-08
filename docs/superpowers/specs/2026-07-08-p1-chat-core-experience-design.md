# P1 对话核心体验设计（Codex 级交互）

日期：2026-07-08 · 状态：已与用户逐节确认，并经独立评审修订（v2）

## 背景与目标

Marginalia 的目标用户场景是**文本工作**（文章解读、基于资料的创作），代码只是辅助手段。
当前对话体验与 Codex 桌面端差距明显。本设计是整体路线的第一期（P1），把对话核心体验
提升到 Codex 级：消息流渲染、Composer、命令/文件变更审批、会话管理四个方向，外加作为
主骨架的审批权限体系；经评审补入文本工作者的三个关键体验（长文阅读、导出、上下文可视）。

### 整体路线（已确认）

| 期               | 范围                                                           |
| ---------------- | -------------------------------------------------------------- |
| **P1（本设计）** | 对话核心体验：消息流、Composer、审批+diff、会话管理、文本体验  |
| P1-B（单列）     | 并行会话 run-state 重构（见第 4 节，独立排期块）               |
| P2               | Skills：启用 pi 原生 skills，加载/管理界面，内置文本工作 skill |
| P3               | 发布打磨：稳定性、错误恢复、打包质量（自用级，预留公开发布）   |
| 后置             | RAG 资料库（方向调研已完成，见文末「后续工作」）               |

### 已定的全局决策

- **运行时保留 pi**（`@earendil-works/pi-coding-agent`）：国产 provider 直连、skills 原生、
  扩展机制支持阻塞式 `tool_call` 拦截（审批可实现）、零迁移成本。单人维护风险用现有
  `AgentClient` 接口抽象对冲。已评估并排除 Claude Agent SDK（专有许可、需 Anthropic
  兼容端点、后端全重写）与 Codex app-server（需 OpenAI Responses API 网关、后端全重写）。
- **产品边界变更**：「内置 bash/命令执行」从非目标改为正式能力，采用审批模型（见第 1 节）。
  `docs/user/concepts.md` 的非目标列表需随本期实现同步更新。
- **审批按副作用分级**（评审修订）：审批的触发条件是「后果」而非「工具类型」——只有动到
  用户既有资产（覆盖/删除已有文件、有副作用的命令）才打断，详见第 1 节。
- **设计基准**：交互模式对齐 Codex 桌面端；关键界面（对话流、diff 审批）用用户提供的
  Codex 截图做布局对齐（design-loop 三联图）；视觉保持现有 mono + serif + emerald 令牌。

## 第 1 节：总体架构与审批权限

**现状**：API 已定义 `readonly / ask / full` 三档权限，但 `ask` 是空操作——
`PiCodingAgentClient` 只对 `readonly` 传工具白名单，选 `ask` 实际等于 `full`。
桌面端 store 的 `permission` 是全局单值且默认 `full`，需改为默认 `ask` 并按会话记忆
（见第 3 节）。

**总体架构不变**（renderer ←SSE← pi-server ←→ pi agent），新增双向审批通道。

**三档权限语义**（按副作用分级）：

| 档位          | 行为                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| `readonly`    | 只给 read/grep/find/ls 只读工具（现状保持）                                  |
| `ask`（默认） | 只读操作与**新建文件**直通；**覆盖/删除已有文件**必审；bash 保守判定（见下） |
| `full`        | 全部直通，事后可查执行记录                                                   |

`ask` 档的副作用判定规则：

- `write`：目标路径已存在 → 审批（附全文 diff）；不存在（新建）→ 直通，但工具卡照常
  显示 diff 供事后查看；
- `edit`：必然修改已有文件 → 审批（附 diff）；
- `bash`：能识别为只读的命令前缀（`ls`/`cat`/`grep`/`head`/`wc` 等保守白名单）→ 直通；
  其余一律审批；用户可勾选「本次会话总是允许此命令前缀」，前缀白名单存于会话级内存；
- 判定器保守优先：无法确定副作用时按需要审批处理。

**审批卡片两种形态**：

1. **命令审批**：完整命令 + 工作目录，「允许 / 拒绝」，附「本次会话总是允许此命令前缀」；
2. **文件变更审批**：unified diff 视图（增删行着色、超长 diff 折叠）；**批准后文件才落盘**。

**关键行为约定**：

- **拒绝 ≠ 终止 run**：拒绝以工具错误回给模型（「用户拒绝了此操作」），模型可调整思路继续；
  拒绝卡片附可选输入框「告诉模型该怎么改」，用户理由随工具错误一并回传（审批从守门变成
  协作转向）；
- **审批记录持久化**：决定存入 SQLite（挂在 run 下），重开会话能看到每条审批的最终结果；
- **兜底安全**：SSE 断开、应用退出时，悬挂审批一律按拒绝处理并中止 run，绝不默认放行。

### 审批数据流子设计（评审修订：这是接口级改造，不是加一个事件类型）

**落点**：审批网关分两层——与 pi 无关的 `ApprovalGateway`（副作用判定 + pending 表 +
决定回传）和 pi 对接层（extension factory）。

1. **pi 对接**：`PiCodingAgentClient` 为每个 session 构造
   `DefaultResourceLoader({ extensionFactories: [approvalExtension], eventBus })`
   （现状 `createSession` 未传 resourceLoader，属新增）。approvalExtension 在
   `tool_call` 事件（异步、可阻塞）中调用 ApprovalGateway：需审批时生成 approvalId、
   通过共享 eventBus 发出审批请求、await pending Promise；拒绝则返回
   `{ block: true, reason: 用户理由 }`。不使用 `ctx.ui.confirm`（TUI 概念，headless
   下无真实 UI）。
2. **权限档动态化**：session 在 registry 中被缓存复用，而权限档每次 run 可变——审批策略
   对象挂在 registry 的 session handle 上，每次 `run()` 开始时更新，extension 每次
   `tool_call` 读取当前值。
3. **AgentClient 接口扩展**：`AgentRunResult` 的事件流合入审批事件；`AgentClient` 增加
   `resolveApproval(sessionId, approvalId, decision)`。SSE 层将审批作为 run envelope 的
   第三类事件（`approval_requested` / `approval_resolved`），与 `run_started` /
   `agent_event` / `run_completed` 并列——**`agent_event` 仍保持纯 pi 透传不动**，红线不破。
   桌面端新增 `POST /sessions/:sid/approvals/:id { decision, reason? }` 回传决定。
4. **diff 生成复用 pi**：不自写 diff。预览用 pi 导出的
   `generateUnifiedPatch(path, oldContent, newContent)`；`edit` 工具入参只有
   `oldText/newText`，pi-server 需**读盘 + 用 pi 的 edit 应用函数模拟**得到完整新文，
   再生成 diff——保证预览与 pi 实际落盘结果一致（含 fuzzy 匹配行为）。
5. **持久化与重开 merge**：`approvals` 表（id, run_id, tool_call_id, kind,
   payload(diff/命令), decision, reason, decided_at）。重开会话时，消息接口在 pi session
   文件消息之外附带审批元数据，桌面端按 `toolCallId` merge 到对应工具卡，渲染最终结果态
   （批准/拒绝/过期）。
6. **测试策略**（修正原「fake-agent-client 测审批」的不自洽）：ApprovalGateway 独立于
   pi，直接单测（判定规则、pending 生命周期、断开即拒绝）；pi 对接层用真 extension 的
   小型集成测试（真 session + 假模型）；`FakeAgentClient` 增加可编程审批脚本，用于 SSE
   envelope 层与桌面端的端到端测试。

## 第 2 节：消息流渲染

现状问题：ToolCard 单行不可展开、思考过程是一坨斜体、代码块无高亮无复制、自动滚动强制跟随、
正文排版未为长文优化。

1. **工具卡片重做**（Codex 式折叠卡片）
   - 默认一行摘要，按工具类型定制：`read` 显示文件名、`bash` 显示命令、`edit/write`
     显示文件名 + diff 统计（`+12 -3`）；
   - 点击展开：完整参数与输出（等宽、可滚动、可复制），edit/write 展开显示 diff；
   - 状态机：`运行中（脉冲）→ 等待审批（琥珀）→ 成功 / 失败 / 被拒绝`，审批卡片内嵌于此；
   - **bash 运行中实时输出**：pi 的 `tool_execution_update` 事件携带累计输出
     （`partialResult`，整体替换式）。注意：desktop 现在**丢弃** partialResult
     （当 `tool_execution_start` 同支处理），这是纯新增消费逻辑——卡片运行中展开等宽
     输出区，实时显示尾部若干行，结束后收起为一行摘要（命令 + 退出状态）。其它慢工具
     复用同一机制。
2. **思考过程折叠化**：流式中显示「思考中…」+ 实时文本（长在所属助手消息内，废除现在
   顶部的 transient reasoning 区）；结束后自动折叠为「已思考 · N 秒」，点击展开回看。
3. **长文阅读体验**（评审补入：文本工作者每天盯着看的东西，优先级高于 diff 着色）：
   正文最大行长与排版宽度按可读性定（约 65–75 字符）；标题层级视觉区分明确；段落
   行距与中英文混排优化；**长回答自动生成锚点目录**（消息内标题导航）；serif 用于
   正文阅读、mono 用于代码/路径的既有令牌体系落实到每类元素。
4. **导出与产物操作**（评审补入：产出物拿得走才算闭环）：每条助手消息悬浮操作——
   **复制全文（Markdown）**、**导出为 .md 文件**、**存入 workspace**（弹出文件名；
   用户主动写入不走 agent 审批流，仅当目标文件已存在时弹覆盖确认）；代码块单独复制保留。
5. **Markdown 质量**：代码块语法高亮（倾向 shiki）+ 悬浮复制按钮 + 语言标签；表格、
   引用块、外链（系统浏览器打开）样式补齐，全部走现有设计令牌。
6. **滚动行为**：跟随底部，用户向上滚动即暂停跟随，右下角出现「回到底部」胶囊
   （带新内容提示）；流式结束或点击胶囊恢复。
7. **回合级文件变更摘要**：run 结束若有文件变更，回合末尾显示「修改了 N 个文件 +a -b」，
   点击展开逐文件 diff（数据复用第 1 节合成的 diff）。
8. **一致性约束**：live 流式与重开会话渲染必须一致；助手气泡边界以 pi `message_start`
   为准；审批卡片重开时按持久化元数据渲染最终结果态（见第 1 节子设计第 5 条）。

## 第 3 节：Composer 输入体验

现状已有骨架（@文件菜单、slash 菜单、模型选择、权限切换、停止按钮），补齐手感：

1. **运行中不锁输入框**：运行时可继续打字，回车后消息**排队**（显示在消息流末尾的
   「已排队」态，可点 × 撤回），回合结束自动发送；`Esc` 停止当前 run。
2. **文件上下文：引用与上传分离**（参照 Codex/Cursor/Claude Cowork 的共同心智模型——
   引用是指针，上传把外部内容带进工作区）：
   - **@引用（工作区内）**：改为 Codex 式**路径引用**——芯片只携带路径，prompt 注明
     「用户引用了这些文件」，agent 用自己的 read 工具按需读取（替代现状的全文内联，
     省 token、不怕大文件）；小文件（<2KB）保留内联优化。模糊搜索（路径+文件名）、
     最近打开优先；从文档树**拖拽文件到输入框**即添加引用；
   - **上传（工作区外）**：回形针按钮 + 从 Finder 拖拽 → 文件**复制进 workspace 的
     `uploads/` 目录**（文件树可见），自动生成一条带「已上传」标记的引用芯片。沙箱边界
     不破，文件成为工作区真实资产；
   - 两种芯片视觉区分：引用芯片显示相对路径，上传芯片带上传图标。
3. **上下文可视条**（评审补入：信任来自透明）：输入框上方一条紧凑指示——「本轮上下文：
   N 个文件 · 约 X token」，点开可见文件清单并可单个移除；数据来源 pi 的 `context`
   钩子，成本低。
4. **快捷键**：`Enter` 发送 / `Shift+Enter` 换行（设置可切换风格）；`Cmd+N` 新会话、
   `Esc` 停止、`@` 文件菜单、`/` 命令菜单（P2 接 skills 后列出 skill）；按钮 tooltip
   标注快捷键。
5. **草稿与状态持久化**：现状 `permission/composerModel/reasoning/contextFiles` 是
   store 全局单值——改为**按 sessionId 分键**的结构；每会话的草稿、@文件列表、模型/
   权限/推理选择独立记忆，切换不丢；权限默认 `ask`（含存量默认值迁移）。
6. **选择器打磨**：模型选择器按 provider 分组、显示可用性；推理力度与权限档做成输入框
   下沿的紧凑芯片组。

**暂不做**（记入后续）：粘贴图片/截图进对话（pi 支持图片消息，等视觉场景明确）；语音输入。

## 第 4 节：会话管理与错误处理

**会话管理**（现状：只能新建/切换，不能改名删除，无运行指示）：

1. 会话**重命名、删除**（带确认）；后端补 `DELETE /sessions/:id`，并扩展
   `PATCH /sessions/:id` 接受 `title`（现状只接受 `model`）；
2. **自动命名**：首轮完成后用当前 provider 生成 ≤12 字标题（失败回退首条用户消息截断）；
3. **并行会话（P1-B，独立排期块）**：这是 run-state 重构，不是增量功能——现状 run/
   streaming 状态完全活在 `ChatView` + `useStreamingChat` 组件内，随 sessionId 切换即
   重置。P1-B 把 SSE 生命周期与 run 状态**提升为 session-keyed 的常驻管理器**（store
   层），实现多会话同时跑、切换不打断后台 run、侧栏运行中指示点与等待审批琥珀标记。
   在 P1-B 完成前，P1 主线保证最低限度：切走再切回不丢已生成内容（从 pi session 文件
   恢复）；
4. **Quick chat 入口**：后端已有 `POST /quick-chat`，补前端（`Cmd+Shift+N` / 侧栏按钮）；
5. 会话列表：相对时间、最后消息摘要、按最近活动排序。

**错误处理**（原则：每种故障必须有明确可见结果，不允许卡住；任何中断都在消息流的
确切位置留可重试的终态卡，而非只有顶部 toast）：

1. **孤儿 run 回收**：pi-server 启动时把 DB 里仍 running 的 run 置为 failed（「意外中断」）；
   渲染端重载后从 pi session 文件重放消息（单一事实源）；
2. **悬挂审批**：断开/退出 → 拒绝并中止 run；恢复后显示「审批已过期」终态卡片；
3. **provider 错误人话化**：401/403 → key 无效指引；429 → 限流提示；网络错误区分
   「本机服务未就绪」与「模型服务商不可达」；
4. **重试语义**：run_failed 重试保留；排队消息失败后留队不丢，由用户决定重发或撤回。

## 第 5 节：测试与验收

沿用 commit gate（TDD + typecheck/test + lint/format + Electron 截图 + 视觉回归），P1 特有：

**单元/集成测试**（分层策略见第 1 节子设计第 6 条）：

- `ApprovalGateway` 独立单测：副作用判定规则（写已有/新建、bash 前缀白名单、保守兜底）、
  pending 生命周期（挂起→放行/拒绝/断开即拒绝）、理由回传；
- pi 对接层集成测试：真 extension + 假模型，验证 `tool_call` 阻塞、`{ block, reason }`
  注入、权限档动态切换；
- diff 预览包装层测试：复用 `generateUnifiedPatch` 的读盘+模拟管线（中文内容、空文件、
  新建文件边界）；
- `FakeAgentClient` 扩展可编程审批脚本，覆盖 SSE envelope 层与桌面端审批卡端到端；
- 排队消息 store 层测试（入队、自动发送、失败保留、撤回）；
- 会话恢复一致性：同一 pi session 文件 + 审批元数据，live 渲染与重开渲染快照对比。

**截图场景扩展**（`verify-screenshots.mjs`）：命令审批（等待态）、diff 审批（展开）、
被拒绝工具卡终态（含理由）、bash 运行中输出区、thinking 折叠/展开、回合变更摘要、
排队消息、上传芯片 vs 引用芯片、上下文可视条、长文渲染（标题目录）、导出操作、
侧栏运行/审批指示（P1-B）。每个新 UI 状态必须能被 fixture 打到。

**验收标准（P1 完成的定义）**：

1. `ask` 档下覆盖/删除已有文件、非白名单命令必产生审批卡片，批准前不落盘不执行；
   新建文件与只读命令零打断；拒绝后 run 不中断且理由回传模型；
2. 四个痛点区域与设计截图对齐（design-loop 三联图通过）；
3. 中英文 i18n 全覆盖（zh `satisfies` 检查通过）；
4. 真实工作流实测：在债务数据 workspace 中 @引用 PDF → agent 读取分析 → 写摘要文件
   （新建直通，覆盖经审批）→ 导出结论 md → 重开会话渲染一致（含审批终态）。

## 后续工作（本期不做，方向已调研）

- **RAG 资料库**（用户决定后置）：需求是独立大资料库（样本 `~/Documents/债务数据`：
  251 个 PDF / 604MB，中文财政债券文档，抽样 40% 为纯扫描件——法律意见书、详细信息表，
  OCR 不可绕过）。倾向方案：平台无关的「核心库 + MCP 双形态」——`library-core`（解析分流、
  VLM OCR 走 provider 视觉模型、LanceDB 混合检索）与 `library-mcp`（标准 MCP server 供
  外部 agent 平台）；Marginalia 进程内直用 core。最终形态待 RAG 期启动时再确认。
- P2 Skills、P3 发布打磨的详细设计各自单独立项。
- 对照阅读/引用溯源（点击 agent 引用定位原文，P2 候选）；回答内编辑/续写（P2 候选）；
  图片消息、语音输入、MCP 客户端扩展（若要接第三方 MCP 生态）。
