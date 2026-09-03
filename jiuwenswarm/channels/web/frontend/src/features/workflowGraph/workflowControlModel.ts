import {
  isSequentialAgentPhase,
  type WorkflowGraphEdge,
  type WorkflowGraphLayout,
  type WorkflowRun,
} from './workflowGraphModel.js';

export type WorkflowRefKind = 'phase' | 'agent';
export type WorkflowDispatchKind = 'sequence' | 'parallel' | 'review';
export type ReviewerType = 'verifier' | 'inspector' | 'challenger';

export interface WorkflowNodeRef {
  kind: WorkflowRefKind;
  phaseId: string;
  agentId?: string;
}

export interface WorkflowDispatchRelation {
  id: string;
  from: WorkflowNodeRef;
  to: WorkflowNodeRef;
  kind: WorkflowDispatchKind;
  label?: string;
  reviewerType?: ReviewerType;
  maxReviewRounds?: number;
  enabled: boolean;
  inferred: boolean;
}

export interface WorkflowControlSpec {
  workflowId: string;
  relations: WorkflowDispatchRelation[];
  /** Enabled review relations execute in this order (scheduled reviewer dispatch). */
  reviewOrder: string[];
}

const REVIEW_HINT = /审|验|review|verify/i;
const STORYBOARD_HINT = /分镜|storyboard/i;
const KEYFRAME_HINT = /关键帧|keyframe/i;

export function graphNodeId(ref: WorkflowNodeRef): string {
  if (ref.kind === 'agent' && ref.agentId) {
    return `agent:${ref.phaseId}:${ref.agentId}`;
  }
  return `phase:${ref.phaseId}`;
}

export function refFromGraphNodeId(nodeId: string): WorkflowNodeRef | null {
  if (nodeId.startsWith('agent:')) {
    const rest = nodeId.slice('agent:'.length);
    const split = rest.indexOf(':');
    if (split <= 0) return null;
    return { kind: 'agent', phaseId: rest.slice(0, split), agentId: rest.slice(split + 1) };
  }
  if (nodeId.startsWith('phase:')) {
    return { kind: 'phase', phaseId: nodeId.slice('phase:'.length) };
  }
  return null;
}

function relationId(kind: WorkflowDispatchKind, from: WorkflowNodeRef, to: WorkflowNodeRef): string {
  return `${kind}:${graphNodeId(from)}->${graphNodeId(to)}`;
}

function findAgentByHint(
  run: WorkflowRun,
  hint: RegExp,
): { phaseId: string; agentId: string; name: string } | null {
  for (const phase of run.phases) {
    for (const agent of phase.agents) {
      if (hint.test(agent.name)) {
        return { phaseId: phase.id, agentId: agent.id, name: agent.name };
      }
    }
  }
  return null;
}

/** Map a SwarmFlow run onto scheduled-dispatch relations (depends_on / parallel / reviewer). */
export function inferDispatchRelations(run: WorkflowRun): WorkflowDispatchRelation[] {
  const relations: WorkflowDispatchRelation[] = [];
  const rootPhases = run.phases.filter((phase) => !phase.parent_phase);

  rootPhases.forEach((phase, index) => {
    if (index > 0) {
      const from = { kind: 'phase' as const, phaseId: rootPhases[index - 1].id };
      const to = { kind: 'phase' as const, phaseId: phase.id };
      relations.push({
        id: relationId('sequence', from, to),
        from,
        to,
        kind: 'sequence',
        label: `${rootPhases[index - 1].name} → ${phase.name}`,
        enabled: true,
        inferred: true,
      });
    }
    const stackAgents = isSequentialAgentPhase(phase);
    phase.agents.forEach((agent, agentIndex) => {
      if (agentIndex === 0) return;
      const prev = phase.agents[agentIndex - 1];
      const from = { kind: 'agent' as const, phaseId: phase.id, agentId: prev.id };
      const to = { kind: 'agent' as const, phaseId: phase.id, agentId: agent.id };
      const kind = stackAgents ? 'sequence' : 'parallel';
      relations.push({
        id: relationId(kind, from, to),
        from,
        to,
        kind,
        label: stackAgents ? `${prev.name} → ${agent.name}` : `${prev.name} ∥ ${agent.name}`,
        enabled: true,
        inferred: true,
      });
    });
  });

  const storyboard = findAgentByHint(run, STORYBOARD_HINT);
  const keyframes = findAgentByHint(run, KEYFRAME_HINT);
  const reviewAgents = run.phases.flatMap((phase) =>
    phase.agents
      .filter((agent) => REVIEW_HINT.test(agent.name))
      .map((agent) => ({ phaseId: phase.id, agent, name: agent.name })),
  );

  if (storyboard && keyframes) {
    const sbReviewsKf = reviewAgents.find((item) => STORYBOARD_HINT.test(item.name) && KEYFRAME_HINT.test(item.name));
    const kfReviewsSb = reviewAgents.find(
      (item) => KEYFRAME_HINT.test(item.name) && STORYBOARD_HINT.test(item.name) && item !== sbReviewsKf,
    );
    const pair: Array<{ from: typeof storyboard; to: typeof storyboard; prefer?: typeof reviewAgents[0] }> = [
      { from: storyboard, to: keyframes, prefer: sbReviewsKf },
      { from: keyframes, to: storyboard, prefer: kfReviewsSb },
    ];
    for (const item of pair) {
      const from = { kind: 'agent' as const, phaseId: item.from.phaseId, agentId: item.from.agentId };
      const to = { kind: 'agent' as const, phaseId: item.to.phaseId, agentId: item.to.agentId };
      relations.push({
        id: relationId('review', from, to),
        from,
        to,
        kind: 'review',
        label: `${item.from.name} → ${item.to.name}`,
        reviewerType: 'verifier',
        maxReviewRounds: 1,
        enabled: true,
        inferred: true,
      });
    }
  } else {
    for (const item of reviewAgents) {
      const peer = item.phaseId
        ? run.phases.find((phase) => phase.id === item.phaseId)?.agents.find((agent) => agent.id !== item.agent.id)
        : undefined;
      if (!peer) continue;
      const from = { kind: 'agent' as const, phaseId: item.phaseId, agentId: item.agent.id };
      const to = { kind: 'agent' as const, phaseId: item.phaseId, agentId: peer.id };
      relations.push({
        id: relationId('review', from, to),
        from,
        to,
        kind: 'review',
        reviewerType: 'verifier',
        maxReviewRounds: 1,
        enabled: true,
        inferred: true,
      });
    }
  }

  return relations;
}

export function inferWorkflowControl(run: WorkflowRun): WorkflowControlSpec {
  const relations = inferDispatchRelations(run);
  return {
    workflowId: run.id,
    relations,
    reviewOrder: relations.filter((item) => item.kind === 'review' && item.enabled).map((item) => item.id),
  };
}

export function normalizeWorkflowControl(raw: unknown, fallbackWorkflowId = ''): WorkflowControlSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const workflowId =
    (typeof record.workflowId === 'string' && record.workflowId) ||
    (typeof record.workflow_id === 'string' && record.workflow_id) ||
    fallbackWorkflowId;
  if (!workflowId) return null;
  const relationsRaw = Array.isArray(record.relations) ? record.relations : [];
  const relations = relationsRaw.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const rel = item as Record<string, unknown>;
    const from = rel.from;
    const to = rel.to;
    if (!from || typeof from !== 'object' || !to || typeof to !== 'object') return [];
    const fromRec = from as Record<string, unknown>;
    const toRec = to as Record<string, unknown>;
    const fromRef: WorkflowNodeRef = {
      kind: fromRec.kind === 'agent' ? 'agent' : 'phase',
      phaseId: typeof fromRec.phaseId === 'string' ? fromRec.phaseId : '',
      agentId: typeof fromRec.agentId === 'string' ? fromRec.agentId : undefined,
    };
    const toRef: WorkflowNodeRef = {
      kind: toRec.kind === 'agent' ? 'agent' : 'phase',
      phaseId: typeof toRec.phaseId === 'string' ? toRec.phaseId : '',
      agentId: typeof toRec.agentId === 'string' ? toRec.agentId : undefined,
    };
    if (!fromRef.phaseId || !toRef.phaseId) return [];
    const kind =
      rel.kind === 'review' || rel.kind === 'parallel' || rel.kind === 'sequence' ? rel.kind : 'sequence';
    const reviewerType =
      rel.reviewerType === 'inspector' || rel.reviewerType === 'challenger' || rel.reviewerType === 'verifier'
        ? rel.reviewerType
        : kind === 'review'
          ? 'verifier'
          : undefined;
    const rounds = typeof rel.maxReviewRounds === 'number' ? rel.maxReviewRounds : undefined;
    return [
      {
        id: typeof rel.id === 'string' && rel.id ? rel.id : `rel-${index}`,
        from: fromRef,
        to: toRef,
        kind,
        label: typeof rel.label === 'string' ? rel.label : undefined,
        reviewerType,
        maxReviewRounds: rounds,
        enabled: rel.enabled !== false,
        inferred: rel.inferred === true,
      } satisfies WorkflowDispatchRelation,
    ];
  });
  const reviewOrder = Array.isArray(record.reviewOrder)
    ? record.reviewOrder.filter((item): item is string => typeof item === 'string')
    : relations.filter((item) => item.kind === 'review' && item.enabled).map((item) => item.id);
  return { workflowId, relations, reviewOrder };
}

export function extractWorkflowControlsFromMetadata(raw: unknown): WorkflowControlSpec[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const controls = record.workflow_control;
  if (!controls || typeof controls !== 'object') return [];
  const values = Array.isArray(controls)
    ? controls
    : Object.entries(controls as Record<string, unknown>).map(([id, spec]) =>
        spec && typeof spec === 'object' ? { workflowId: id, ...(spec as object) } : spec,
      );
  return values
    .map((item) => normalizeWorkflowControl(item))
    .filter((item): item is WorkflowControlSpec => item !== null);
}

/** User edits win; newly inferred relations are appended. */
export function mergeWorkflowControl(
  inferred: WorkflowControlSpec,
  saved?: WorkflowControlSpec | null,
): WorkflowControlSpec {
  if (!saved) return inferred;
  const byId = new Map(inferred.relations.map((item) => [item.id, item]));
  for (const rel of saved.relations) {
    const base = byId.get(rel.id);
    byId.set(rel.id, base ? { ...base, ...rel, inferred: false } : rel);
  }
  const reviewOrder =
    saved.reviewOrder.length > 0
      ? saved.reviewOrder.filter((id) => byId.get(id)?.kind === 'review')
      : inferred.reviewOrder;
  return {
    workflowId: inferred.workflowId,
    relations: Array.from(byId.values()),
    reviewOrder,
  };
}

export function overlayDispatchRelations(
  layout: WorkflowGraphLayout,
  spec: WorkflowControlSpec,
): WorkflowGraphLayout {
  const structural = layout.edges.filter((edge) => edge.kind === 'contains');
  const sequencePairs = new Set(
    spec.relations
      .filter((rel) => rel.enabled && rel.kind === 'sequence')
      .map((rel) => `${graphNodeId(rel.from)}>${graphNodeId(rel.to)}`),
  );
  const dispatchEdges: WorkflowGraphEdge[] = spec.relations
    .filter((rel) => {
      if (!rel.enabled) return false;
      if (rel.kind === 'parallel' && sequencePairs.has(`${graphNodeId(rel.from)}>${graphNodeId(rel.to)}`)) {
        return false;
      }
      return true;
    })
    .map((rel) => ({
      from: graphNodeId(rel.from),
      to: graphNodeId(rel.to),
      kind: rel.kind,
      relationId: rel.id,
    }));
  return {
    ...layout,
    edges: [...structural, ...dispatchEdges],
    groups: layout.groups ?? [],
  };
}

export function updateRelation(
  spec: WorkflowControlSpec,
  relationId: string,
  patch: Partial<WorkflowDispatchRelation>,
): WorkflowControlSpec {
  return {
    ...spec,
    relations: spec.relations.map((rel) =>
      rel.id === relationId ? { ...rel, ...patch, inferred: false } : rel,
    ),
  };
}

export function reverseReviewRelation(spec: WorkflowControlSpec, relationId: string): WorkflowControlSpec {
  const current = spec.relations.find((rel) => rel.id === relationId);
  if (!current || current.kind !== 'review') return spec;
  const next = {
    ...current,
    from: current.to,
    to: current.from,
    label: current.label?.includes('→')
      ? current.label.split('→').map((part) => part.trim()).reverse().join(' → ')
      : current.label,
    inferred: false,
  };
  return {
    ...spec,
    relations: spec.relations.map((rel) => (rel.id === relationId ? next : rel)),
    reviewOrder: spec.reviewOrder,
  };
}

export function moveReviewOrder(spec: WorkflowControlSpec, relationId: string, delta: -1 | 1): WorkflowControlSpec {
  const order = [...spec.reviewOrder];
  const index = order.indexOf(relationId);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return spec;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  return { ...spec, reviewOrder: order };
}
