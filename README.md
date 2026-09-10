**JiuwenSwarm extension to support multi-modal creation/design scenarios and designer-users.**

This branch is always (re-)based on `img-vid-gen-inline` and/or other branches that support image and video generation provider configuration.

-----------

## 本版已澄清的三个问题 / Three questions clarified in this PR

下面按当前 `design` 实现写实，不写目标态。画布上的连线在代码里叫 `edges`，产品里常叫 trajectory。  
The answers below match the current `design` implementation, not a future target. Canvas lines are `edges` in code; the product often calls them trajectories.

---

### 1. Graph 中的 trajectory 是否具有输入 / 输出含义？  
### 1. Do graph trajectories carry input / output meaning?

**中文**

**有调度含义，没有通用的“沿边传物料”语义。**

- 每条边是 `source → target`，`kind` 只有两种：
  - `data`：上游完成，下游才可跑。执行器读 `data_predecessors()`，节点一旦就绪就开跑，不必等同一列其它节点。
  - `sync`：屏障，不是 payload。例如 Character 与 Storyboard 的 Align 边：两边必须都完成，依赖它们的节点才开跑。
- 节点真正吃到的输入，**不是**沿边遍历，而是按 **role / shot_index** 去读 `run.node_states[*].output_ref`：
  - Brief 文本、Storyboard 表、Character / Scene 图、对应镜的 Keyframe。
  - Clip 参考图顺序：本镜关键帧 → 角色图 → 场景图，外加分镜 markdown `file`。
- `config.inputs` 在 bootstrap / expand 时会写成与 `data` 边一致，但 **handler 执行时不读这个字段**。
- 因此：连线表达的是“谁先谁后、谁依赖谁完成”；字节级 I/O 是“按角色取产物”。改一条自定义边，只要角色还在图里，handler 仍可能按角色取料，而不会改走那条边。
- Keyframe 之间 **没有** `n_frame_i → n_frame_{i+1}` 边，后几镜也不把上一镜当 i2i 参考（纯文生图，避免撞构图）。Clip 只等 **本镜** Keyframe；Keyframe 2/3 完成后，Clip 2/3 可以马上并行，不必等 Keyframe 1。

**English**

**Trajectories gate scheduling. They are not a generic payload bus.**

- Each edge is `source → target` with two kinds:
  - `data`: the target stays pending until every data predecessor (and that predecessor's `sync` group) is completed. The executor starts a node as soon as it is ready; it does not wait for the rest of the column.
  - `sync`: a barrier, not a payload. Example: Character ↔ Storyboard Align. Dependents wait until both members finish.
- Actual inputs are **not** walked along edges. Handlers load artifacts by **role / shot_index** from `run.node_states[*].output_ref`:
  - Brief text, Storyboard table, Character / Scene stills, the matching Keyframe.
  - Clip `reference_image` order: this shot's keyframe → character → scene, plus the storyboard markdown `file`.
- `config.inputs` is kept in sync with `data` edges at bootstrap / expand time, but **handlers never read it at execute time**.
- So the line on the canvas means “this node may not start until that node finished.” Byte-level I/O means “fetch the artifact of this role.” Drawing a custom edge does not reroute handler inputs if the roles still exist.
- Keyframes are **not** chained. There is no `n_frame_i → n_frame_{i+1}` edge, and later shots still do **not** use the previous still as an i2i reference (text-to-image, so they do not clone shot 1). A clip waits only on **its** keyframe, so Clip 2 and Clip 3 can start as soon as Keyframe 2 and 3 finish, even if Keyframe 1 is still running.

---

### 2. E2A 协议的调用和监听逻辑？  
### 2. How does the E2A protocol call and listen?

**中文**

E2A（Everything-to-Agent）是 **Gateway ↔ AgentServer** 的统一信封，不是画布节点互相同步用的协议。规范见 `docs/zh/E2A-protocol.md`。Designer 的 RPC 走 unary E2A；运行态靠 **push** 回听。

**调用（浏览器 → AgentServer）**

```
Browser  webRequest('designer.graph.*' | 'designer.run.*')
    → Gateway WebSocket handler
    → proxy_unary_request()
    → e2a_from_agent_fields(...)     # E2AEnvelope
         method  = designer.graph.get / designer.run.start / …
         params  = 业务字典（graph_id、prompt、node_id…）
    → AgentServerClient（WebSocket）
    → DesignerAdapter.handle()
    → GraphStore / GraphExecutor
    → 同一条 unary 连接把 AgentResponse 折回 Gateway
    → channel.send_response 给浏览器
```

本地单用户若 AgentServer 暂不可达，Gateway 可能走 legacy 共享目录，直接跑同一套 `DesignerAdapter`（不经远程 E2A）。AgentOS / 远程 client **没有**这条 fallback。

**监听（AgentServer → 浏览器）**

`designer.run.start` 的 unary 只返回当时的 run 快照。节点推进是异步的，靠 push：

```
GraphExecutor._publish(run, node_id)
    → DesignerAdapter on_update / on_graph_update
    → WebSocketGatewayPushTransport.send_push
         event_type = designer.run.updated
                      designer.node.updated
                      designer.graph.updated
    → Gateway 旁路投递到浏览器 WebSocket（不占用原 RPC 等待队列）
    → bindDesignerRuntime():
         webClient.on('designer.run.updated' | 'designer.node.updated' | 'designer.graph.updated')
```

不要把下面两套和 E2A 混在一起：

| 名称 | 实际是什么 | 是否 E2A |
|------|------------|----------|
| Designer RPC | `designer.graph.*` / `designer.run.*` | 是，unary 信封 |
| Designer 运行态 | 上述三种 `event_type` push | 是，下行 push |
| Designer A2A collab | 进程内 `DesignerA2ABus`（角色卡对齐） | **否** |
| 网关入站 A2A Channel | 外部 Agent → 聊天入口 | **否**（与画布无关） |

**English**

E2A (Everything-to-Agent) is the **Gateway ↔ AgentServer** envelope, not the protocol nodes use to talk to each other. Spec: `docs/en/E2A-protocol.md`. Designer RPCs are unary E2A. Runtime progress is a **push** listen path.

**Call (browser → AgentServer)**

```
Browser  webRequest('designer.graph.*' | 'designer.run.*')
    → Gateway WebSocket handler
    → proxy_unary_request()
    → e2a_from_agent_fields(...)     # E2AEnvelope
         method  = designer.graph.get / designer.run.start / …
         params  = business dict (graph_id, prompt, node_id, …)
    → AgentServerClient (WebSocket)
    → DesignerAdapter.handle()
    → GraphStore / GraphExecutor
    → AgentResponse folds back on the same unary hop
    → channel.send_response to the browser
```

On a local single-user install, if AgentServer is down, Gateway may run the same `DesignerAdapter` against the shared `~/.jiuwenswarm` directory (no remote E2A). AgentOS / remote clients **do not** get that fallback.

**Listen (AgentServer → browser)**

The unary `designer.run.start` reply is only the run snapshot at start time. Node progress is async and pushed:

```
GraphExecutor._publish(run, node_id)
    → DesignerAdapter on_update / on_graph_update
    → WebSocketGatewayPushTransport.send_push
         event_type = designer.run.updated
                      designer.node.updated
                      designer.graph.updated
    → Gateway delivers on the browser WebSocket (bypass; not the original RPC waiter)
    → bindDesignerRuntime():
         webClient.on('designer.run.updated' | 'designer.node.updated' | 'designer.graph.updated')
```

Do not confuse these with E2A:

| Name | What it actually is | E2A? |
|------|---------------------|------|
| Designer RPC | `designer.graph.*` / `designer.run.*` | Yes, unary envelope |
| Designer runtime | the three `event_type` pushes above | Yes, downlink push |
| Designer A2A collab | in-process `DesignerA2ABus` (role-card alignment) | **No** |
| Inbound Gateway A2A Channel | external Agent → chat entry | **No** (not the canvas) |

---

### 3. 当前节点的 Agent 是否实际参与作用？作用机制如何？  
### 3. Does the per-node Agent actually participate, and how?

**中文**

**默认 Play 管线里，节点 DeepAgent 不跑。真正干活的是 role handler。**

机制分三层，不要看成“每个节点一个独立 Agent 在对话”：

1. **调度**  
   UI `designer.graph.bootstrap` 会调用 `_prefer_handler_pipeline()`，给所有未写 `delegate` 的节点打上 `delegate: "handler"`。于是 `graph_uses_agent_scheduler()` 为假，走 `_execute_wave_run`：按 `data`/`sync` 判断就绪，节点一就绪就 `create_task`，不必等同一列其它节点结束。

2. **节点执行（默认）**  
   `_run_single_node` 见 `delegate != handler` 才进 `NodeAgentHost`。当前 bootstrap 图全部是 handler，所以直接 `get_node_handler(node).execute()`：
   - Brief / Storyboard：聊天模型写 Markdown
   - Character / Scene / Keyframe：生图 API（失败则写 notes）
   - Clip：wan3 `reference_image`；Film：ffmpeg concat + 垫乐
   - Character+Scene 同一波时，handler **之前**还会跑进程内 A2A：双方先起草角色/场景卡，交叉约束，再生成；Storyboard 草稿会让这两张卡审一列。这是 LLM 人设，不是 `NodeAgentHost`。

3. **节点 Agent（代码在，默认关掉）**  
   `NodeAgentHost` 会按 `config.agent_template`（缺省 `designer/leader|character|scene|storyboard|frame|clip`）拉 AgentGroup，造一个 DeepAgent，带 `designer_graph_get` / `designer_graph_patch` / `designer_node_run` / `designer_node_complete`。失败则回退 handler。  
   仓库里 **没有** 内置 `resources/.../agent_groups/designer` 包，模板加载会空，即便打开 `delegate: "agent"` 也很容易立刻 fallback。  
   成片节点在 expand 时写死 `delegate: "handler"`，不会交给 Agent。

若要把节点 Agent 真正接上：节点不要被 bootstrap 改成 handler（或事后改回 `delegate: "agent"`），并提供可加载的 `designer` AgentGroup；那时执行器改走 `_execute_agent_run`，对第一波就绪节点 `spawn_node_agent`。这不是当前 UI Play 路径。

**English**

**On the default Play pipeline, per-node DeepAgents do not run. Role handlers do the work.**

There are three layers. This is not “each node is a live chatting Agent”:

1. **Scheduling**  
   UI `designer.graph.bootstrap` calls `_prefer_handler_pipeline()`, which stamps `delegate: "handler"` on every node that has no explicit delegate. Then `graph_uses_agent_scheduler()` is false and the executor uses `_execute_wave_run`: a node is `create_task`'d as soon as its `data`/`sync` predecessors complete, without waiting for the rest of the column.

2. **Node execution (default)**  
   `_run_single_node` enters `NodeAgentHost` only when `delegate != handler`. Bootstrap graphs are all handlers, so they call `get_node_handler(node).execute()`:
   - Brief / Storyboard: chat model writes Markdown
   - Character / Scene / Keyframe: image API (notes on failure)
   - Clip: wan3 `reference_image`; Film: ffmpeg concat + BGM mix
   - When Character and Scene share a wave, handlers are preceded by in-process A2A: both draft cards, exchange constraints, then generate; the Storyboard draft is reviewed against those cards. That is specialist LLM text, not `NodeAgentHost`.

3. **Node Agent (implemented, off by default)**  
   `NodeAgentHost` would load `config.agent_template` (defaults `designer/leader|character|scene|storyboard|frame|clip`), build a DeepAgent with `designer_graph_get` / `designer_graph_patch` / `designer_node_run` / `designer_node_complete`, and fall back to the handler on failure.  
   This repo **does not** ship `resources/.../agent_groups/designer`, so template load returns empty. Even with `delegate: "agent"`, the host tends to fail fast into the handler.  
   Film is always `delegate: "handler"` after shot expand.

To actually turn node Agents on: do not let bootstrap stamp handler (or set `delegate: "agent"` later) and ship a loadable `designer` AgentGroup. The executor then uses `_execute_agent_run` and `spawn_node_agent` on the first ready wave. That is not the current UI Play path.

-----------

最终架构实现方向（**不一定现在就采用。做plugin抽离又是额外的架构考量。目前快速prototype直接写进主代码仓好了**）：

- 目前主仓并没有提供含UI能力的拓展机制。只有：
  - Plugin Package（plugin_packages，可热装）：Skills + Tools，对话里按包装配
  - Harness Package：Tools / Skills / Rails，热激活
  - Agent Template / Group：人设、角色组
  - Skill / Swarm Skill：单 Agent 或团队协作流程
  - `jiuwenswarm/extensions/`（`extension.yaml`）：后端钩子（如 AgentServerClient、ThirdAgent）
  - A2UI：聊天里的生成式表单/卡片
  - Settings overlay：设置页模块组合（偏内建扩展）
- 在现有现状下，我们的实现全量合入主仓，默认随发行可用。
  - 前端：扩写现有 channels/web/frontend（导航、Designer 空间、画布、prompt→project 跳转）。
  - Agent 侧能力：放在 `jiuwenswarm/resources/agent/workspace/plugins/plugin_packages/<你的模块>/`（skills / tools，可参考 content-creation），作为内置 package，不是用户另装。
  - 还需要进主仓、但通常不塞进 plugin_packages 的，是壳与编排：例如 `work_mode`/路由、project API、gateway handler、画布图执行/状态——这些跟现有 server/web 代码长在一起。

----------

----------

**以下是目前可快速上手的大致架构和合作建议（AI于9月2日早生成，部分内容可能随开发变动而过时）**

把「执行图」拆成三层，Python 侧放在 `jiuwenswarm/common/schema/`，前后端通过 WS RPC + 契约测试对齐；UI 和 executor 只依赖同一套 domain model，不互相 import。

这和 README 里「壳与编排跟 server/web 长在一起」、以及仓库现有惯例（`common/schema/` 为 canonical、前端 hand-mirror TS、pytest 做跨层比对）是一致的。

---

## 1. 放哪里：三层，不要混成一份

你们实际需要 **三种数据**，职责不同：

| 层 | 是什么 | 放哪里 | 谁消费 |
|---|---|---|---|
| **A. Domain Graph（真相源）** | 节点/边/依赖/执行语义 | `jiuwenswarm/common/schema/designer_graph.py` | 后端 executor + 前端类型镜像 |
| **B. Run State（运行时状态）** | 每个 node 的 running/done/failed、输出引用 | `jiuwenswarm/server/runtime/designer/`（或 `session/`） | executor 写，前端订阅 |
| **C. View State（展示层）** | React Flow 的 `position`、`selected`、viewport | 前端 `features/designer/` | 仅 UI；可选持久化到 graph metadata |

**关键原则：React Flow 的 `nodes/edges` 不是真相源，只是 View 投影。**

```
                    ┌─────────────────────┐
  prompt/bootstrap  │  DesignerExecutionGraph │  ← schema_version, nodes[], edges[]
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     toReactFlowView()   GraphExecutor    SubagentRail / tools
     (UI 投影)           (调度/对齐/合并)   (真正跑 agent)
              │                │
              ▼                ▼
     ReactFlow nodes/edges   ExecutionRun + node_states
                             (WS events 推给前端)
```

Symphony 里已有 `execution_graph { nodes, edges }` 和 `workflow_state.py` 的运行态模式，可以 **借鉴 shape**，但不要直接复用 schema——Symphony 是 skill 拓扑，你们是 **Designer 多媒体创作 DAG**。

---

## 2. Domain Graph

第一版地基尽量小，但字段要够你们后面扩展。写在 `jiuwenswarm/common/schema/designer_graph.py`

**和 React Flow 的分工：**

- Domain：`id`, `type`, `config`, `layout`（可选持久化位置）
- React Flow：从 domain 映射出 `position`/`type`/`data`；选中态、拖拽中的临时坐标可以不立刻写回
- **素材本体不进 node 大 payload**：node 只存 `asset_ref` / `output_ref`，大文件走 project 存储或 artifact API

Graph 的 Run State 单独一份（类似 `workflow_runs`），储存 graph 全局的state和内部每个node的state

---

## 3. 前后端怎么对接（沿用现有惯例）

仓库没有 protobuf/OpenAPI codegen，做法是：

| 项 | 位置 |
|---|---|
| Python canonical | `jiuwenswarm/common/schema/designer_graph.py` |
| RPC 方法名 | `jiuwenswarm/common/schema/message.py` → `ReqMethod` |
| Gateway handlers | `jiuwenswarm/gateway/.../app_web_handlers.py`（参考 `project.*`） |
| 持久化 | `server/runtime/designer/graph_store.py`（参考 `project_store.py`） |
| 前端类型 | `channels/web/frontend/src/features/designer/executionGraphTypes.ts` |
| 前端 client | `designerGraphClient.ts`（参考 `projectRegistryClient.ts`） |
| 契约测试 | `tests/unit_tests/test_designer_execution_graph_contract.py` |

建议第一版 RPC（够两人并行）：

```
designer.graph.get          # 读 domain graph
designer.graph.save         # 写 domain graph（含 layout）
designer.graph.bootstrap    # prompt → project + 初始 graph
designer.run.start          # 从某 node 或整图开跑
designer.run.get            # 读 run state
designer.run.pause / cancel
```

事件（WS push，参考 `chat.subtask_update`）：

```
designer.node.updated       # 单 node 状态变化
designer.run.updated        # run 级状态
designer.graph.updated      # 图结构被 agent 改写（可选）
```

---

## 4. 地基 PR 做到什么程度，够 UI / Agent 分头干

目标：**两人只依赖 schema + stub API + fixture，不互相 block。**

### 必须做（第一地基 PR）

1. **Schema + 常量 + 示例 fixture**
   - `designer_graph.py` + `executionGraphTypes.ts`
   - `tests/fixtures/designer-execution-graph.v1.json`（含：概览 → 双 subagent 对齐 → 合并 → 分头生成）
   - 契约测试：node types、edge kinds、`schema_version`、必填字段

2. **Graph ↔ React Flow 纯函数 adapter（前端）**
   - `toReactFlowGraph(domainGraph) → { nodes, edges }`
   - `fromReactFlowGraph(rf, domainGraph) → domainGraph`（只回写 layout + 结构变更）
   - 用 fixture 单测，**不依赖后端**

3. **Graph store + RPC stub（后端）**
   - `get/save/bootstrap` 能读写 JSON
   - `run.start/get` 先返回 mock 状态机（例如 2s 后把 node 标成 done）
   - executor 接口先定：`GraphExecutor.run(graph, run_id) -> AsyncIterator[NodeEvent]`

4. **Executor 接口，不实现具体 subagent**
   ```python
   class NodeHandler(Protocol):
       async def execute(self, node, ctx) -> NodeResult: ...

   NODE_HANDLERS: dict[str, NodeHandler]  # type -> handler
   ```
   Agent 同学只需填 `character_design` / `storyboard` 等 handler；UI 同学不用碰。

5. **Project 绑定**
   - 每个 graph 挂 `project_id`（复用 `project_store`）
   - `designer.graph.bootstrap`：`prompt → create project → 生成初始 graph`

### 可以第二轮再做

- 真实 subagent 调度（SubagentRail 集成）
- `sync` 边的 barrier 逻辑
- 画布多媒体 preview / NodeToolbar
- Agent 自动改图（graph patch / merge）

### 建议两人分工切线

| 你（UI / React Flow） | 合作者（Agent / 执行流） |
|---|---|
| `features/designer/` 页面、React Flow 画布 | `server/runtime/designer/executor.py` |
| `toReactFlowGraph` / 节点组件 stub | `NODE_HANDLERS` 各 type 实现 |
| 订阅 `designer.node.updated` 染状态 | `sync` / `merge` 调度策略 |
| layout 编辑 → `designer.graph.save` | prompt → 初始 graph 的生成逻辑 |

**唯一共享面：fixture JSON + TypeScript types + Python schema + RPC 名。**

---

## 5. 几个容易踩坑、现在就该定下来的点

1. **Graph 定义 vs Run 状态必须分开**  
   否则 UI 拖拽保存会把 `running` 状态写乱，或 rerun 时清不干净。

2. **Node `config` 要 typed，别全是 `Record<string, unknown>`**  
   按 `type`  discriminated union；前后端各一份，契约测试 pin 合法 type 列表。

3. **对齐边（sync/barrier）是一等公民**  
   角色设计 + 分镜设计「互相对齐」不要硬编码在 executor if-else，用 `edge.kind = "sync"` + scheduler 读入度/屏障。

4. **素材引用，不是素材本体**  
   node 里放 `output_ref: { kind: "image", uri: "..." }`，播放/预览 UI 再 resolve。

5. **不要放进 plugin_packages**  
   按 README，壳与编排在 `server/web`；plugin_packages 只放 skills/tools（如「重新生成这张图」的具体 tool）。

6. **别和 Symphony skill graph 混存储**  
   可以抄 `SkillGraphPanel` 的布局思路，但 Designer graph 独立 `schema_version` 和存储路径。

---

## 6. 建议的第一批文件清单

```
jiuwenswarm/common/schema/designer_graph.py
jiuwenswarm/common/schema/message.py                    # + ReqMethod
jiuwenswarm/server/runtime/designer/graph_store.py
jiuwenswarm/server/runtime/designer/executor.py         # 接口 + mock
jiuwenswarm/server/runtime/designer/handlers/__init__.py
jiuwenswarm/gateway/.../app_web_handlers.py             # designer.graph.* / designer.run.*

jiuwenswarm/channels/web/frontend/src/features/designer/
  executionGraphTypes.ts
  designerGraphAdapter.ts      # domain <-> React Flow
  designerGraphClient.ts
  fixtures/designer-execution-graph.v1.json

tests/unit_tests/test_designer_execution_graph_contract.py
```
