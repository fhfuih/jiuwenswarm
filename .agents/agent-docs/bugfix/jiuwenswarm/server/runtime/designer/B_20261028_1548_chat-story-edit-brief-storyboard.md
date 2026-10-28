---
id: B_20261028_1548_chat-story-edit-brief-storyboard
title: Design 模式对话修改故事事实后大纲与分镜不更新
type: B
author: Zeyu Huang
author_email: fhfuih@outlook.com
modules:
  - jiuwenswarm/server/runtime/designer
  - jiuwenswarm/server/runtime/design
  - jiuwenswarm/agents/swarm
  - jiuwenswarm/agents/harness/design
files:
  - jiuwenswarm/server/runtime/designer/story_edit.py
  - jiuwenswarm/server/runtime/designer/handlers/text_nodes.py
  - jiuwenswarm/server/runtime/design/context.py
  - jiuwenswarm/agents/swarm/providers/designer_tools.py
  - jiuwenswarm/agents/swarm/assembly.py
  - jiuwenswarm/agents/harness/design/rails/designer_surface_sanitizer_rail.py
  - tests/unit_tests/design/test_story_edit.py
designs: []
design_note: 普通缺陷修复，无独立设计；沿用导演链 approved_brief / approved_storyboard 回放契约。
---

# Design 模式对话修改故事事实后大纲与分镜不更新

## 现象与影响

GitHub #8820 / GitCode #5476：画布生成后，在对话里要求“把全片的女店员改成男店员”，
图片和视频跟着改了，Brief（大纲）仍是女店员。前一次修复（#9447 / 0.2.8 #9448）合入后回归仍失败。
同类：对话修改镜头里的道具（白杯→红杯），场景图变了，视频与发送给视频模型的提示词始终是旧的。

## 关联设计与当前契约

导演链批准一次 `metadata.approved_brief`、`approved_storyboard` 与 `script_analysis.characters`
（`production_specs` 由后者生成），Brief / 分镜 handler 每次运行都回放这些文本，不读节点 prompt。
执行器“已产出即冻结”：cascade 只重跑起点及其下游，上游保持原样。

## 根因与修复决策

前一次修复只在“leader patch 了 Brief 节点 prompt，且 Brief 随后重跑”时生效，真实路径三个前提都不成立：

1. Brief 的 prompt 是用户原始需求，常不含被改的事实；leader 改的是角色 / 镜头节点，patch 也改不到 metadata。
2. leader 从角色或镜头节点 cascade，Brief 在上游，按冻结规则不重跑。
3. 即便从 Brief 重跑，分镜 handler 回放旧 `approved_storyboard`，并经
   `sync_shot_nodes_from_storyboard_markdown` 把旧动作写回镜头节点的 `clip_action` / `generate.prompt`。
   另外 Brief handler 每次会从旧 `script_analysis` 重建 `production_specs` 并附在大纲末尾。

修复：

- 新增 `story_edit.apply_story_edit`：按修改要求依次修订大纲、角色设定（只改字符串字段与
  `identity_attrs`，按 id 合并）与分镜表（行数、行序、镜号锁定，按规范表头重新渲染），
  全部成功后才写入 metadata，再同步镜头节点并重建 `production_specs`。
- leader 新工具 `designer_story_edit(edit)`（`StoreNodeSpawner.apply_story_edit`）：运行中或
  report-only 时拒绝，修订后立即落盘并推送画布；返回 Brief 节点 id，提示 leader 从 Brief cascade 重跑。
  加入 leader 工具保留名单，并在 leader 系统提示中规定故事级修改的流程。
- 保留 prompt patch 路径并扩展到分镜：`mark_story_prompt_edits` 识别 Brief / 分镜 prompt 修改；
  Brief 重跑时走完整修订，分镜重跑时只修订分镜；修订后清除 `user_edit_prompt`，不再每次重跑都重新调用模型。

同类案例：对话要求“把白色杯子改成红色杯子”后场景图变了、视频不变，leader 连续 patch 镜头节点
`config.prompt` 每次运行都被还原。原因：镜头视频调用的节拍来自分镜行（`clip_action`），非用户来源的
prompt 会被 `director_approve_video_prompt` 按节拍重写，`_stamp_sent_prompt` 再把发送文本写回
`prompt` / `generate.prompt`。工具栏编辑之所以有效，是因为前端 `writeMediaGeneratePatch` 同时写了
`user_edit_prompt`、`generate.prompt_origin="user"` 与 `regenerate_packet.prompt`。

- 新增 `mark_clip_prompt_edits`：`designer_graph_patch` 改了镜头节点 `prompt` 或 `generate.prompt` 时，
  按前端同一契约标记为用户来源；leader 系统提示与 `designer_story_edit` 描述补充道具 / 场景细节。

备选与取舍：只在 handler 运行中修订被否决——运行有任一节点失败时协调器不保存图，metadata 修订会丢失；
只改 leader 提示让其 patch Brief prompt 被否决——仍依赖模型碰巧选择正确节点且无法修正分镜回放。
分镜修订锁定镜头数：增删镜头属于拓扑修改，继续走 `designer_graph_patch`。

## 回归证据与适用范围

候选：`cursor/story-edit-brief-storyboard-6686`（develop）与 0.2.8 同名修复分支。
`tests/unit_tests/design/test_story_edit.py`（21 例，假模型）覆盖：工具修订并落盘三类文本、
随后 Brief / 分镜重跑输出男店员且不再调用模型、运行中 / 无批准文本 / report-only 拒绝且图不变、
分镜丢行时整体不写入、镜号锁定、工具挂载且通过 leader 工具保留名单、prompt patch 路径与无修改回放、
镜头 prompt patch 获得用户来源且连续两次视频调用都保留红杯（去掉标记时该例复现“白杯”）。
`tests/unit_tests/design`、`tests/unit_tests/agents`、`tests/agents/swarm` 共 1337 通过；
`test_manifest_catalog` 与 `test_swarm_assembly` 各 1 例在未改动的 develop 上同样失败，与本修复无关。
未验证：真实模型下 leader 是否稳定选择 `designer_story_edit`，需用真实会话回归。

## 防错模式与资料同步

导演链批准文本被 handler 回放时，任何“改故事”的入口都必须改写批准文本本身并同步其派生物
（`production_specs`、镜头节点节拍），不能只改节点 prompt。leader 新工具须同时加入
`designer_surface_sanitizer_rail._KEEP_TOOL_NAMES`，否则会被静默移除。

## 遗留与后续

- `script_analysis.clips` 等其余分析字段未修订；镜头节点以分镜同步结果为准。
- 角色 / 场景节点 prompt 仍需 leader 按工具返回提示 patch。
- 结构化场景设定未修订：镜头节点的 `scene_specs`（建图时从场景复制，`scene_master_prompt` 已存在后不再刷新）
  会以“Scene description: white ceramic cup”注入视频 prompt，用户来源编辑也不例外；是否由
  `designer_story_edit` 修订或每次运行从场景刷新待决策。
- 已带用户来源的镜头不再跟随后续分镜修订（与工具栏编辑一致），是否在故事级修改时清除待决策。
