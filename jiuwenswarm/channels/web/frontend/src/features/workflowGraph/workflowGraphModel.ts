export type WorkflowStatus =
  | "planned"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "waiting_for_human";

export type WorkflowNodeType = "agent" | "agent_session" | "human" | "human_session";

export interface WorkflowAgent {
  id: string;
  name: string;
  status: WorkflowStatus;
  node_type?: WorkflowNodeType;
  kind?: "agent" | "human";
  correlation_id?: string;
  human_prompt?: string;
  human_reply?: string;
}

export interface WorkflowPhase {
  id: string;
  name: string;
  status: WorkflowStatus;
  agents: WorkflowAgent[];
  phase_type?: "child" | null;
  parent_phase?: string | null;
}

export interface WorkflowRun {
  id: string;
  name: string;
  summary?: string;
  status: WorkflowStatus;
  phases: WorkflowPhase[];
}

export type WorkflowGraphNodeKind = "run" | "phase" | "agent";

export interface WorkflowGraphNode {
  id: string;
  kind: WorkflowGraphNodeKind;
  label: string;
  status: WorkflowStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  phaseId?: string;
  agent?: WorkflowAgent;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  kind: "sequence" | "contains" | "parallel" | "review";
  relationId?: string;
}

export interface WorkflowGraphGroup {
  id: string;
  label: string;
  phaseId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowGraphLayout {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  groups: WorkflowGraphGroup[];
  width: number;
  height: number;
}

const PHASE_WIDTH = 168;
const PHASE_HEIGHT = 44;
const AGENT_WIDTH = 132;
const AGENT_HEIGHT = 32;
const PHASE_GAP_Y = 80;
const CHILD_PHASE_GAP_X = 80;
const AGENT_GAP_X = 88;
const AGENT_STACK_GAP_Y = 56;
const PHASE_AGENT_GAP_Y = 52;

const SEQUENTIAL_PHASE_HINT = /校对|优化|审稿|验收|返工/;
const SEQUENTIAL_AGENT_HINT = /审|改|验|review|revise|verify/i;

/** Review/rework agents in one phase run in order, not as a parallel fan-out. */
export function isSequentialAgentPhase(phase: WorkflowPhase): boolean {
  if (SEQUENTIAL_PHASE_HINT.test(phase.name)) return true;
  if (phase.agents.length < 2) return false;
  const sequentialCount = phase.agents.filter((agent) => SEQUENTIAL_AGENT_HINT.test(agent.name)).length;
  return sequentialCount >= 2 && sequentialCount >= phase.agents.length - 1;
}
const RUN_PHASE_GAP_Y = 56;
const RUN_HEIGHT = 40;
const PAD = 32;

const STATUSES: WorkflowStatus[] = [
  "planned",
  "pending",
  "running",
  "completed",
  "failed",
  "stopped",
  "waiting_for_human",
];

function asStatus(value: unknown): WorkflowStatus {
  return STATUSES.includes(value as WorkflowStatus) ? (value as WorkflowStatus) : "planned";
}

const NODE_TYPES: WorkflowNodeType[] = ["agent", "agent_session", "human", "human_session"];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function normalizeWorkflowRun(raw: unknown): WorkflowRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  if (!id) return null;
  const phasesRaw = Array.isArray(record.phases) ? record.phases : [];
  const phases: WorkflowPhase[] = phasesRaw.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const phase = item as Record<string, unknown>;
    const phaseId = asString(phase.id, `phase-${index}`);
    const agentsRaw = Array.isArray(phase.agents) ? phase.agents : [];
    const agents: WorkflowAgent[] = agentsRaw.flatMap((agentItem, agentIndex) => {
      if (!agentItem || typeof agentItem !== "object" || Array.isArray(agentItem)) return [];
      const agent = agentItem as Record<string, unknown>;
      const agentId = asString(agent.id, `${phaseId}-agent-${agentIndex}`);
      return [
        {
          id: agentId,
          name: asString(agent.name, agentId),
          status: asStatus(agent.status),
          node_type: NODE_TYPES.includes(agent.node_type as WorkflowNodeType)
            ? (agent.node_type as WorkflowNodeType)
            : undefined,
          kind: agent.kind === "human" ? "human" : "agent",
          correlation_id: asString(agent.correlation_id) || undefined,
          human_prompt: asString(agent.human_prompt) || undefined,
          human_reply: asString(agent.human_reply) || undefined,
        },
      ];
    });
    return [
      {
        id: phaseId,
        name: asString(phase.name, phaseId),
        status: asStatus(phase.status),
        agents,
        phase_type: phase.phase_type === "child" ? "child" : null,
        parent_phase: asString(phase.parent_phase) || null,
      },
    ];
  });
  return {
    id,
    name: asString(record.name, id),
    summary: asString(record.summary) || undefined,
    status: asStatus(record.status),
    phases,
  };
}

function phaseRowWidth(phase: WorkflowPhase): number {
  if (phase.agents.length <= 1 || isSequentialAgentPhase(phase)) return PHASE_WIDTH;
  return Math.max(PHASE_WIDTH, phase.agents.length * AGENT_WIDTH + (phase.agents.length - 1) * AGENT_GAP_X);
}

export type WorkflowNodePosition = { x: number; y: number };

/** Overlay user-dragged coordinates on the auto layout; grow the stage if needed. */
export function applyNodePositions(
  layout: WorkflowGraphLayout,
  positions: Record<string, WorkflowNodePosition>,
  pad = PAD,
): WorkflowGraphLayout {
  const nodes = layout.nodes.map((node) => {
    const pos = positions[node.id];
    if (!pos) return node;
    return { ...node, x: pos.x, y: pos.y };
  });
  const maxX = nodes.reduce((acc, node) => Math.max(acc, node.x + node.width), 0);
  const maxY = nodes.reduce((acc, node) => Math.max(acc, node.y + node.height), 0);
  const next = {
    ...layout,
    nodes,
    width: Math.max(layout.width, maxX + pad),
    height: Math.max(layout.height, maxY + pad),
  };
  return { ...next, groups: groupsFromNodes(next.nodes) };
}

const GROUP_PAD_X = 16;
const GROUP_PAD_Y = 12;

/** Phase box plus its agents — shows 首稿 containing 分镜 / 关键帧. */
export function groupsFromNodes(nodes: WorkflowGraphNode[]): WorkflowGraphGroup[] {
  const phases = nodes.filter((node) => node.kind === "phase" && node.phaseId);
  return phases.flatMap((phase) => {
    const agents = nodes.filter((node) => node.kind === "agent" && node.phaseId === phase.phaseId);
    if (agents.length === 0) return [];
    const members = [phase, ...agents];
    const x = Math.min(...members.map((node) => node.x)) - GROUP_PAD_X;
    const y = Math.min(...members.map((node) => node.y)) - GROUP_PAD_Y;
    const right = Math.max(...members.map((node) => node.x + node.width)) + GROUP_PAD_X;
    const bottom = Math.max(...members.map((node) => node.y + node.height)) + GROUP_PAD_Y;
    return [
      {
        id: `group:${phase.phaseId}`,
        label: phase.label,
        phaseId: phase.phaseId ?? "",
        x,
        y,
        width: right - x,
        height: bottom - y,
      },
    ];
  });
}

export function layoutWorkflowRun(run: WorkflowRun): WorkflowGraphLayout {
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];
  const rootPhases = run.phases.filter((phase) => !phase.parent_phase);
  const childPhases = run.phases.filter((phase) => phase.parent_phase);

  const trunkWidth = Math.max(PHASE_WIDTH, ...rootPhases.map((phase) => phaseRowWidth(phase)), 200);
  const runWidth = Math.min(Math.max(trunkWidth, 200), 280);
  const hasChildren = childPhases.length > 0;
  const contentWidth = trunkWidth + (hasChildren ? CHILD_PHASE_GAP_X + PHASE_WIDTH : 0);
  const centerX = PAD + trunkWidth / 2;
  const phaseX = centerX - PHASE_WIDTH / 2;
  const phaseYs: number[] = [];

  nodes.push({
    id: `run:${run.id}`,
    kind: "run",
    label: run.name,
    status: run.status,
    x: centerX - runWidth / 2,
    y: PAD,
    width: runWidth,
    height: RUN_HEIGHT,
  });

  let y = PAD + RUN_HEIGHT + RUN_PHASE_GAP_Y;
  rootPhases.forEach((phase, index) => {
    nodes.push({
      id: `phase:${phase.id}`,
      kind: "phase",
      label: phase.name,
      status: phase.status,
      x: phaseX,
      y,
      width: PHASE_WIDTH,
      height: PHASE_HEIGHT,
      phaseId: phase.id,
    });
    phaseYs.push(y);
    if (index === 0) {
      edges.push({
        from: `run:${run.id}`,
        to: `phase:${phase.id}`,
        kind: "contains",
      });
    } else {
      edges.push({
        from: `phase:${rootPhases[index - 1].id}`,
        to: `phase:${phase.id}`,
        kind: "sequence",
      });
    }

    y += PHASE_HEIGHT;
    if (phase.agents.length > 0) {
      y += PHASE_AGENT_GAP_Y;
      const stackAgents = isSequentialAgentPhase(phase);
      const agentsWidth = stackAgents
        ? AGENT_WIDTH
        : phase.agents.length * AGENT_WIDTH + Math.max(0, phase.agents.length - 1) * AGENT_GAP_X;
      let agentX = centerX - agentsWidth / 2;
      phase.agents.forEach((agent, agentIndex) => {
        const agentNodeId = `agent:${phase.id}:${agent.id}`;
        nodes.push({
          id: agentNodeId,
          kind: "agent",
          label: agent.name,
          status: agent.status,
          x: stackAgents ? centerX - AGENT_WIDTH / 2 : agentX,
          y,
          width: AGENT_WIDTH,
          height: AGENT_HEIGHT,
          phaseId: phase.id,
          agent,
        });
        edges.push({
          from: `phase:${phase.id}`,
          to: agentNodeId,
          kind: "contains",
        });
        if (stackAgents) {
          if (agentIndex > 0) {
            edges.push({
              from: `agent:${phase.id}:${phase.agents[agentIndex - 1].id}`,
              to: agentNodeId,
              kind: "sequence",
            });
          }
          y += AGENT_HEIGHT;
          if (agentIndex < phase.agents.length - 1) y += AGENT_STACK_GAP_Y;
        } else {
          if (agentIndex > 0) {
            edges.push({
              from: `agent:${phase.id}:${phase.agents[agentIndex - 1].id}`,
              to: agentNodeId,
              kind: "parallel",
            });
          }
          agentX += AGENT_WIDTH + AGENT_GAP_X;
        }
      });
      if (!stackAgents) y += AGENT_HEIGHT;
    }
    y += PHASE_GAP_Y;
  });

  childPhases.forEach((phase) => {
    const parentIndex = rootPhases.findIndex(
      (root) => root.name === phase.parent_phase || root.id === phase.parent_phase,
    );
    const parent = parentIndex >= 0 ? rootPhases[parentIndex] : null;
    if (!parent) return;
    nodes.push({
      id: `phase:${phase.id}`,
      kind: "phase",
      label: phase.name,
      status: phase.status,
      x: PAD + trunkWidth + CHILD_PHASE_GAP_X,
      y: phaseYs[parentIndex],
      width: PHASE_WIDTH,
      height: PHASE_HEIGHT,
      phaseId: phase.id,
    });
    edges.push({
      from: `phase:${parent.id}`,
      to: `phase:${phase.id}`,
      kind: "contains",
    });
  });

  const groups = groupsFromNodes(nodes);
  const maxX = Math.max(
    PAD + contentWidth,
    ...nodes.map((node) => node.x + node.width),
    ...groups.map((group) => group.x + group.width),
  );
  const maxY = Math.max(
    0,
    ...nodes.map((node) => node.y + node.height),
    ...groups.map((group) => group.y + group.height),
  );
  return {
    nodes,
    edges,
    groups,
    width: maxX + PAD,
    height: maxY + PAD,
  };
}

export function extractWorkflowPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.workflow && typeof record.workflow === "object") return record.workflow;
  const nested = record.payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    if (inner.workflow && typeof inner.workflow === "object") return inner.workflow;
  }
  if (typeof record.id === "string") return record;
  return null;
}

/** Restore persisted SwarmFlow snapshots from session.get_metadata. */
export function extractWorkflowRunsFromMetadata(raw: unknown): WorkflowRun[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const runs = record.workflow_runs;
  if (!runs || typeof runs !== "object") return [];
  const values = Array.isArray(runs) ? runs : Object.values(runs as Record<string, unknown>);
  return values
    .map((item) => normalizeWorkflowRun(item))
    .filter((run): run is WorkflowRun => run !== null);
}

function mergeWorkflowAgent(existing: WorkflowAgent | undefined, incoming: WorkflowAgent): WorkflowAgent {
  return { ...existing, ...incoming };
}

function mergeWorkflowPhase(existing: WorkflowPhase | undefined, incoming: WorkflowPhase): WorkflowPhase {
  const mergedAgents = [...(existing?.agents ?? [])];
  for (const incomingAgent of incoming.agents) {
    const index = mergedAgents.findIndex((agent) => agent.id === incomingAgent.id);
    const nextAgent = mergeWorkflowAgent(index === -1 ? undefined : mergedAgents[index], incomingAgent);
    if (index === -1) mergedAgents.push(nextAgent);
    else mergedAgents[index] = nextAgent;
  }
  return { ...existing, ...incoming, agents: mergedAgents };
}

/** Merge a workflow.updated delta into the last full snapshot (phases are incremental). */
export function mergeWorkflowRun(existing: WorkflowRun | undefined, incoming: WorkflowRun): WorkflowRun {
  const mergedPhases = [...(existing?.phases ?? [])];
  for (const incomingPhase of incoming.phases) {
    const index = mergedPhases.findIndex((phase) => phase.id === incomingPhase.id);
    const nextPhase = mergeWorkflowPhase(index === -1 ? undefined : mergedPhases[index], incomingPhase);
    if (index === -1) mergedPhases.push(nextPhase);
    else mergedPhases[index] = nextPhase;
  }
  return {
    ...existing,
    ...incoming,
    phases: mergedPhases,
  };
}
