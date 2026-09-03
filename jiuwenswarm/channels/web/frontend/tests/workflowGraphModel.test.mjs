import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyNodePositions,
  extractWorkflowPayload,
  extractWorkflowRunsFromMetadata,
  isSequentialAgentPhase,
  layoutWorkflowRun,
  mergeWorkflowRun,
  normalizeWorkflowRun,
} from '../node_modules/.cache/workflow-graph/features/workflowGraph/workflowGraphModel.js';
import {
  inferWorkflowControl,
  mergeWorkflowControl,
  overlayDispatchRelations,
  reverseReviewRelation,
} from '../node_modules/.cache/workflow-graph/features/workflowGraph/workflowControlModel.js';

test('normalizeWorkflowRun rejects payloads without id', () => {
  assert.equal(normalizeWorkflowRun({ name: 'flow' }), null);
  assert.equal(normalizeWorkflowRun(null), null);
});

test('layoutWorkflowRun stacks phases top-to-bottom and fans out parallel agents', () => {
  const run = normalizeWorkflowRun({
    id: 'run-1',
    name: 'research',
    status: 'running',
    phases: [
      {
        id: 'p1',
        name: 'Search',
        status: 'running',
        agents: [
          { id: 'a1', name: 'web', status: 'running' },
          { id: 'a2', name: 'docs', status: 'running' },
        ],
      },
      { id: 'p2', name: 'Write', status: 'planned', agents: [] },
    ],
  });
  assert.ok(run);
  const layout = layoutWorkflowRun(run);
  const runNode = layout.nodes.find((node) => node.kind === 'run');
  const phaseNodes = layout.nodes.filter((node) => node.kind === 'phase');
  const agentNodes = layout.nodes.filter((node) => node.kind === 'agent');
  assert.equal(phaseNodes.length, 2);
  assert.equal(agentNodes.length, 2);
  assert.ok(runNode && runNode.y < phaseNodes[0].y);
  assert.ok(phaseNodes[0].y < agentNodes[0].y);
  assert.ok(agentNodes[0].y < phaseNodes[1].y);
  assert.equal(phaseNodes[0].x, phaseNodes[1].x);
  assert.equal(agentNodes[0].y, agentNodes[1].y);
  assert.notEqual(agentNodes[0].x, agentNodes[1].x);
  assert.ok(agentNodes[1].x - (agentNodes[0].x + agentNodes[0].width) >= 72);
  assert.ok(agentNodes[0].y - (phaseNodes[0].y + phaseNodes[0].height) >= 40);
  assert.ok(phaseNodes[1].y - (agentNodes[0].y + agentNodes[0].height) >= 64);
  assert.ok(layout.edges.some((edge) => edge.kind === 'parallel'));
  assert.ok(layout.edges.some((edge) => edge.from === 'phase:p1' && edge.to === 'phase:p2'));
  assert.ok(layout.edges.some((edge) => edge.kind === 'contains' && edge.from === 'phase:p1' && edge.to === 'agent:p1:a1'));
  assert.ok(layout.edges.some((edge) => edge.kind === 'contains' && edge.from === 'phase:p1' && edge.to === 'agent:p1:a2'));
  assert.ok(layout.groups.some((group) => group.phaseId === 'p1' && group.height > phaseNodes[0].height));
});

test('layoutWorkflowRun stacks review agents in 校对优化 as a sequence', () => {
  const run = normalizeWorkflowRun({
    id: 'wf-review',
    name: 'animation',
    status: 'running',
    phases: [
      {
        id: 'proof',
        name: '校对优化',
        status: 'running',
        agents: [
          { id: 'r1', name: '分镜审关键帧', status: 'completed' },
          { id: 'r2', name: '改关键帧', status: 'completed' },
          { id: 'r3', name: '关键帧审分镜', status: 'running' },
          { id: 'r4', name: '改分镜', status: 'planned' },
        ],
      },
    ],
  });
  assert.ok(run);
  assert.equal(isSequentialAgentPhase(run.phases[0]), true);
  const layout = layoutWorkflowRun(run);
  const agents = layout.nodes.filter((node) => node.kind === 'agent');
  assert.equal(agents.length, 4);
  assert.equal(agents[0].x, agents[1].x);
  assert.ok(agents[0].y < agents[1].y);
  assert.ok(agents[1].y < agents[2].y);
  assert.ok(layout.edges.some((edge) => edge.kind === 'sequence' && edge.from.includes('r1') && edge.to.includes('r2')));
  const spec = inferWorkflowControl(run);
  assert.ok(spec.relations.some((rel) => rel.kind === 'sequence' && rel.from.agentId === 'r1'));
  assert.equal(spec.relations.filter((rel) => rel.kind === 'parallel').length, 0);
});

test('applyNodePositions keeps dragged nodes and grows the stage', () => {
  const run = normalizeWorkflowRun({
    id: 'run-pos',
    name: 'research',
    status: 'running',
    phases: [{ id: 'p1', name: 'Search', status: 'running', agents: [] }],
  });
  assert.ok(run);
  const layout = layoutWorkflowRun(run);
  const moved = applyNodePositions(layout, { 'phase:p1': { x: 420, y: 260 } });
  const phase = moved.nodes.find((node) => node.id === 'phase:p1');
  assert.equal(phase?.x, 420);
  assert.equal(phase?.y, 260);
  assert.ok(moved.width >= 420 + (phase?.width ?? 0));
  assert.ok(moved.height >= 260 + (phase?.height ?? 0));
});

test('extractWorkflowRunsFromMetadata reads persisted workflow_runs dict', () => {
  const runs = extractWorkflowRunsFromMetadata({
    session_id: 'web_1',
    workflow_runs: {
      'wf_1': {
        id: 'wf_1',
        name: 'animation',
        status: 'completed',
        phases: [
          {
            id: 'p1',
            name: 'Overview',
            status: 'completed',
            agents: [{ id: 'a1', name: 'writer', status: 'completed' }],
          },
        ],
      },
    },
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, 'wf_1');
  assert.equal(runs[0].phases[0].agents[0].name, 'writer');
});

test('extractWorkflowPayload reads nested workflow.updated envelopes', () => {
  const extracted = extractWorkflowPayload({
    event_type: 'workflow.updated',
    session_id: 's1',
    workflow: { id: 'run-2', name: 'demo', status: 'completed', phases: [] },
  });
  const run = normalizeWorkflowRun(extracted);
  assert.equal(run?.id, 'run-2');
  assert.equal(run?.status, 'completed');
});

test('inferWorkflowControl maps SwarmFlow phases onto scheduled dispatch relations', () => {
  const run = normalizeWorkflowRun({
    id: 'wf-anim',
    name: 'animation-pipeline',
    status: 'completed',
    phases: [
      { id: 'p0', name: '文字概览', status: 'completed', agents: [{ id: 'a0', name: '概览', status: 'completed' }] },
      {
        id: 'p1',
        name: '首稿',
        status: 'completed',
        agents: [
          { id: 'a1', name: '分镜', status: 'completed' },
          { id: 'a2', name: '关键帧', status: 'completed' },
        ],
      },
      { id: 'p2', name: '校对优化', status: 'completed', agents: [{ id: 'a3', name: '分镜审关键帧', status: 'completed' }] },
    ],
  });
  assert.ok(run);
  const spec = inferWorkflowControl(run);
  assert.ok(spec.relations.some((rel) => rel.kind === 'sequence'));
  assert.ok(spec.relations.some((rel) => rel.kind === 'parallel'));
  const reviews = spec.relations.filter((rel) => rel.kind === 'review');
  assert.equal(reviews.length, 2);
  const reversed = reverseReviewRelation(spec, reviews[0].id);
  assert.equal(reversed.relations.find((rel) => rel.id === reviews[0].id)?.from.agentId, reviews[0].to.agentId);
  const layout = overlayDispatchRelations(layoutWorkflowRun(run), spec);
  assert.ok(layout.edges.some((edge) => edge.kind === 'review'));
});

test('mergeWorkflowControl keeps user edits over inferred defaults', () => {
  const inferred = inferWorkflowControl({
    id: 'wf-1',
    name: 'demo',
    status: 'running',
    phases: [
      { id: 'p1', name: 'A', status: 'completed', agents: [] },
      { id: 'p2', name: 'B', status: 'planned', agents: [] },
    ],
  });
  const seq = inferred.relations.find((rel) => rel.kind === 'sequence');
  assert.ok(seq);
  const saved = mergeWorkflowControl(inferred, {
    ...inferred,
    relations: inferred.relations.map((rel) =>
      rel.id === seq.id ? { ...rel, enabled: false, inferred: false } : rel,
    ),
  });
  assert.equal(saved.relations.find((rel) => rel.id === seq.id)?.enabled, false);
});

test('mergeWorkflowRun keeps earlier phases when a delta only carries one phase', () => {
  const full = normalizeWorkflowRun({
    id: 'run-3',
    name: 'demo',
    status: 'running',
    phases: [
      { id: 'p1', name: 'Search', status: 'completed', agents: [{ id: 'a1', name: 'web', status: 'completed' }] },
      { id: 'p2', name: 'Write', status: 'planned', agents: [] },
    ],
  });
  const delta = normalizeWorkflowRun({
    id: 'run-3',
    name: 'demo',
    status: 'running',
    phases: [
      {
        id: 'p2',
        name: 'Write',
        status: 'running',
        agents: [{ id: 'a2', name: 'writer', status: 'running', correlation_id: 'p2:writer:1' }],
      },
    ],
  });
  assert.ok(full && delta);
  const merged = mergeWorkflowRun(full, delta);
  assert.equal(merged.phases.length, 2);
  assert.equal(merged.phases[0].status, 'completed');
  assert.equal(merged.phases[1].status, 'running');
  assert.equal(merged.phases[1].agents[0].correlation_id, 'p2:writer:1');
});
