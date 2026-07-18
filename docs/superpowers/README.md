# Superpowers 活跃工作

`docs/superpowers/` 只保存正在设计或实施的 spec/plan。完成、取消或被替代的记录会补齐 Implementation Outcome，并移入 [`docs/internal/`](../internal/README.md)。

## Active records

<!-- active-records:start -->

| Record ID               | Type | Status   | Document                                                                      |
| ----------------------- | ---- | -------- | ----------------------------------------------------------------------------- |
| `SPEC-P1-CHAT-CORE-001` | spec | active   | [P1 对话核心体验设计](./specs/2026-07-08-p1-chat-core-experience-design.md)   |
| `SPEC-P2-SKILLS-001`    | spec | approved | [Codex 风格 Skills 集成设计](./specs/2026-07-18-skills-integration-design.md) |

<!-- active-records:end -->

## Rules

- Spec 与 plan 必须使用唯一且不可变的 `record_id`；plan 通过 `source_spec_id` 关联设计。
- 状态、任务进度、偏差和 `docs_impact` 必须随实现同步更新。
- 记录关闭时必须更新正式文档、写 Implementation Outcome、移出本索引并归档。
