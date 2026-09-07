---
name: design-doc-required
description: "Use when a user presents a new requirement, feature, refactor, feasibility discussion, or source-code modification request. Classifies the change as trivial, lightweight, or full-design before implementation."
---

# 开发前设计文档门禁

## 核心规则

在分析实现方案或修改源码前，先判断任务档位并确认设计依据。设计图统一使用 Mermaid。

<HARD-GATE>
除极简改动外，没有已确认的设计文档时，不得开始实现。完整设计还必须有对应的 `-coding.md` 编码摘要。
</HARD-GATE>

## 渐进读取

- 需要判断档位、模板类型或合法例外时，读取 [references/classification.md](references/classification.md)。
- 需要查找、新建、更新设计文档或生成编码摘要时，读取 [references/document-workflow.md](references/document-workflow.md)。
- 只有任务涉及具体文档模板时，读取同目录的 `lightweight-template.md`、`template.md`、`template-tech.md`、`api-template.md` 或 `coding-template.md`。
- 设计中需要 Mermaid 图或需要判断应画哪类图时，读取 [rules/mermaid-requirements.md](rules/mermaid-requirements.md)，并叠加 `markdown-writing-standards` 的语法规则。

## 执行流程

1. 若存在项目知识入口 `00_project_overview.md`，按任务类型读取其中列出的 2–3 份必读文档。
2. 按 `references/classification.md` 判定极简、轻量或完整档位，并向用户回显结论和理由。
3. 极简档直接进入实现；轻量或完整档查找现有稳定设计文档。
4. 文档缺失时，先确定归属和输出路径，再完成索引查重与文档创建。
5. 轻量档读取稳定文档即可；完整档还要读取或生成 `-coding.md`。
6. 用户确认设计依据后，才能进入实施前代码定位。

## 输出约定

默认设计文档位于 `{USER_DOCUMENTS}/ai-docs/{project}/design/{需求名}/`；用户明确指定项目路径时才写入项目 `docs/design/`。Git 管理下始终更新 `-current.md`，仅重大基线、非 Git 场景或用户明确要求时创建快照。

开始实现前回显：已读取的设计文档、核心规则、涉及类和关键约束。

## 实现完成后的知识沉淀（v1.21 起）

**设计落地、代码实现完成后，必须把「本次实现新增/变更的结构类事实」写入 `backend-knowledge-graph-required` 的候选池。** 分期实现的需求每期沉淀各自的新事实，逐期交叉验证、逐次收敛，不存在重复沉淀：

| 实现中新增/变更的事实 | 沉淀目标 |
|---|---|
| 新增/变更的表关联、字段语义 | `_candidates.md`（建议归属：table-logic 卡） |
| 新增/变更的状态流转、枚举语义 | `_candidates.md`（建议归属：枚举/状态卡） |
| 新增/变更的关键 SQL | `_sql_candidates.md` |
| 新增的原子能力（方法 + 入出参 + 读写表） | `_candidates.md`（建议归属：原子能力卡） |

规则：
- **以代码为准**：逐条对照设计文档的状态机/表设计节与实际实现，实现有偏差的按代码沉淀，并在设计文档「代码核实差异」处回填差异
- 分期实现：每期只沉淀**本期新增/变更**的事实；与已有候选同主题的**合并更新**（追加证据、上调置信度），不插重复行；某期结论与前期候选冲突时记录矛盾，不覆盖
- 每条候选带证据位置（类#方法 / 文件:行号）；实现并跑通对应路径的标「已验证」，仅静态实现的标「局部验证」
- 极简档（≤2 文件、≤30 行、无契约/状态机/字段变更）不产生结构事实，跳过沉淀
- 候选池路径：`{USER_DOCUMENTS}/ai-docs/{project}/knowledge-graph/`；目录尚无候选池文件时按 `backend-knowledge-graph-required` 起步结构初始化
- 只写候选不建卡；晋升正式卡由 `backend-knowledge-graph-required` 的验证流程负责

## 红线

- 不得用“任务简单”替代档位清单判断。
- 不得为日常迭代创建连续 `v1/v2/v3` 文件。
- 不得把完整设计的 coding 摘要视为可选。
- 不得把接口契约、状态机、字段或跨服务变更降为极简档。
- 不得在实现完成后跳过知识沉淀（极简档除外）；新代码引入的状态机/字段/SQL/能力不沉淀，下次同类需求就要重新调查。