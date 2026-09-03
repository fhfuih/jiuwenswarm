import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { webRequest } from '../../services/webClient';
import { useSessionStore } from '../../stores/sessionStore';
import {
  applyNodePositions,
  layoutWorkflowRun,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowNodePosition,
  type WorkflowRun,
  type WorkflowStatus,
} from '../../features/workflowGraph/workflowGraphModel';
import {
  inferWorkflowControl,
  mergeWorkflowControl,
  moveReviewOrder,
  overlayDispatchRelations,
  reverseReviewRelation,
  updateRelation,
  type ReviewerType,
  type WorkflowControlSpec,
  type WorkflowDispatchRelation,
} from '../../features/workflowGraph/workflowControlModel';
import './WorkflowGraphPanel.css';

const STATUS_CLASS: Record<WorkflowStatus, string> = {
  planned: 'workflow-graph-node--planned',
  pending: 'workflow-graph-node--planned',
  running: 'workflow-graph-node--running',
  completed: 'workflow-graph-node--completed',
  failed: 'workflow-graph-node--failed',
  stopped: 'workflow-graph-node--stopped',
  waiting_for_human: 'workflow-graph-node--waiting',
};

function edgePoints(
  from: WorkflowGraphNode,
  to: WorkflowGraphNode,
  kind: WorkflowGraphEdge['kind'],
) {
  if ((kind === 'parallel' || kind === 'review') && Math.abs(from.y - to.y) < 8) {
    const left = from.x <= to.x ? from : to;
    const right = from.x <= to.x ? to : from;
    return {
      x1: left.x + left.width,
      y1: left.y + left.height / 2,
      x2: right.x,
      y2: right.y + right.height / 2,
    };
  }
  return {
    x1: from.x + from.width / 2,
    y1: from.y + from.height,
    x2: to.x + to.width / 2,
    y2: to.y,
  };
}

type DragState = {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function WorkflowGraphPanel({
  runs,
  sessionId,
}: {
  runs: WorkflowRun[];
  sessionId: string;
}) {
  const { t } = useTranslation();
  const setWorkflowControl = useSessionStore((state) => state.setWorkflowControl);
  const savedControls = useSessionStore((state) => state.runtimes[sessionId]?.workflowControls ?? {});
  const [selectedRunId, setSelectedRunId] = useState(runs[0]?.id ?? '');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [positionsByRun, setPositionsByRun] = useState<Record<string, Record<string, WorkflowNodePosition>>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySending, setReplySending] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? '');
      setSelectedNodeId(null);
      setSelectedRelationId(null);
    }
  }, [runs, selectedRunId]);

  const active = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const spec = useMemo(() => {
    if (!active) return null;
    return mergeWorkflowControl(inferWorkflowControl(active), savedControls[active.id]);
  }, [active, savedControls]);
  const autoLayout = useMemo(() => {
    if (!active) return null;
    const base = layoutWorkflowRun(active);
    return spec ? overlayDispatchRelations(base, spec) : base;
  }, [active, spec]);
  const positions = active ? positionsByRun[active.id] ?? {} : {};
  const layout = useMemo(
    () => (autoLayout ? applyNodePositions(autoLayout, positions) : null),
    [autoLayout, positions],
  );
  const selectedNode = layout?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedRelation = spec?.relations.find((rel) => rel.id === selectedRelationId) ?? null;
  const waitingAgent =
    selectedNode?.agent?.status === 'waiting_for_human' ? selectedNode.agent : null;
  const canReset = Object.keys(positions).length > 0;

  if (!active || !layout) {
    return (
      <div className="workflow-graph-empty" data-testid="workflow-graph-empty">
        <div className="workflow-graph-empty-title">{t('team.workflow.empty')}</div>
        <p>{t('team.workflow.emptyHint')}</p>
        <p>{t('team.workflow.emptyHintControl')}</p>
      </div>
    );
  }

  const persistControl = async (next: WorkflowControlSpec) => {
    if (!sessionId) return;
    setWorkflowControl(sessionId, next);
    setSaveState('saving');
    try {
      await webRequest('command.workflows', {
        action: 'set_control',
        session_id: sessionId,
        workflow_id: next.workflowId,
        control: next,
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const patchRelation = (relationId: string, patch: Partial<WorkflowDispatchRelation>) => {
    if (!spec) return;
    void persistControl(updateRelation(spec, relationId, patch));
  };

  const sendReply = async () => {
    const correlationId = waitingAgent?.correlation_id;
    const answer = reply.trim();
    if (!sessionId || !correlationId || !answer || replySending) return;
    setReplySending(true);
    setReplyError(null);
    try {
      await webRequest('chat.swarmflow_reply', {
        session_id: sessionId,
        run_id: active.id,
        correlation_id: correlationId,
        answer,
      });
      setReply('');
    } catch {
      setReplyError(t('team.workflow.replyError'));
    } finally {
      setReplySending(false);
    }
  };

  const setNodePosition = (nodeId: string, pos: WorkflowNodePosition) => {
    const runId = active.id;
    setPositionsByRun((prev) => ({
      ...prev,
      [runId]: { ...prev[runId], [nodeId]: pos },
    }));
  };

  const onNodePointerDown = (node: WorkflowGraphNode, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      moved: false,
    };
    setDraggingId(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onNodePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    setNodePosition(drag.nodeId, {
      x: Math.max(8, drag.originX + dx),
      y: Math.max(8, drag.originY + dy),
    });
  };

  const onNodePointerUp = (nodeId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSelectedNodeId(nodeId);
    setSelectedRelationId(null);
    dragRef.current = null;
    setDraggingId(null);
  };

  return (
    <div className="workflow-graph-panel" data-testid="workflow-graph-panel">
      <div className="workflow-graph-header">
        {runs.length > 1 ? (
          <label className="workflow-graph-run-select">
            <select
              value={active.id}
              onChange={(event) => {
                setSelectedRunId(event.target.value);
                setSelectedNodeId(null);
              }}
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="workflow-graph-title">{active.name}</span>
        )}
        <span className={`workflow-graph-status ${STATUS_CLASS[active.status]}`}>
          {t(`team.workflow.status.${active.status}`)}
        </span>
        <span className="workflow-graph-drag-hint">{t('team.workflow.dragHint')}</span>
        {canReset ? (
          <button
            type="button"
            className="workflow-graph-reset"
            onClick={() =>
              setPositionsByRun((prev) => {
                const next = { ...prev };
                delete next[active.id];
                return next;
              })
            }
          >
            {t('team.workflow.resetLayout')}
          </button>
        ) : null}
      </div>
      <div className="workflow-graph-body">
        <div className="workflow-graph-canvas">
          <div className="workflow-graph-legend" data-testid="workflow-graph-legend">
            <span className="workflow-graph-legend-title">{t('team.workflow.legendTitle')}</span>
            {(['contains', 'sequence', 'parallel', 'review'] as const).map((kind) => (
              <span key={kind} className={`workflow-graph-legend-item workflow-graph-legend-item--${kind}`}>
                {t(`team.workflow.dispatch.${kind}`)} · {t(`team.workflow.dispatchMapValue.${kind}`)}
              </span>
            ))}
          </div>
          <div className="workflow-graph-stage" style={{ width: layout.width, height: layout.height }}>
            {(layout.groups ?? []).map((group) => (
              <div
                key={group.id}
                className="workflow-graph-group"
                style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
                data-testid="workflow-graph-group"
              >
                <span className="workflow-graph-group-label">{t('team.workflow.contains')}</span>
              </div>
            ))}
            <svg className="workflow-graph-edges" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id="workflow-arrow-sequence" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8 Z" fill="#1677ff" />
                </marker>
              </defs>
              {layout.edges.map((edge) => {
                const from = layout.nodes.find((node) => node.id === edge.from);
                const to = layout.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                const points = edgePoints(from, to, edge.kind);
                const selected = edge.relationId && edge.relationId === selectedRelationId;
                const midX = (points.x1 + points.x2) / 2;
                const midY = (points.y1 + points.y2) / 2;
                return (
                  <g key={`${edge.from}-${edge.to}-${edge.kind}-${edge.relationId ?? ''}`}>
                    <line
                      x1={points.x1}
                      y1={points.y1}
                      x2={points.x2}
                      y2={points.y2}
                      className="workflow-graph-edge-hit"
                      onClick={() => {
                        if (edge.relationId) {
                          setSelectedRelationId(edge.relationId);
                          setSelectedNodeId(null);
                        }
                      }}
                    />
                    <line
                      x1={points.x1}
                      y1={points.y1}
                      x2={points.x2}
                      y2={points.y2}
                      className={`workflow-graph-edge workflow-graph-edge--${edge.kind}${
                        selected ? ' workflow-graph-edge--selected' : ''
                      }`}
                      markerEnd={edge.kind === 'sequence' ? 'url(#workflow-arrow-sequence)' : undefined}
                    />
                    <text
                      x={midX}
                      y={midY - 8}
                      className={`workflow-graph-edge-label workflow-graph-edge-label--${edge.kind}`}
                    >
                      {t(`team.workflow.dispatchMapValue.${edge.kind}`)}
                    </text>
                  </g>
                );
              })}
            </svg>
            {layout.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`workflow-graph-node workflow-graph-node--${node.kind} ${STATUS_CLASS[node.status]}${
                  selectedNodeId === node.id ? ' workflow-graph-node--selected' : ''
                }${draggingId === node.id ? ' workflow-graph-node--dragging' : ''}`}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                data-testid={`workflow-graph-node-${node.kind}`}
                title={node.label}
                onPointerDown={(event) => onNodePointerDown(node, event)}
                onPointerMove={onNodePointerMove}
                onPointerUp={(event) => onNodePointerUp(node.id, event)}
                onPointerCancel={(event) => onNodePointerUp(node.id, event)}
              >
                {node.label}
              </button>
            ))}
          </div>
        </div>
        <aside className="workflow-graph-inspector">
          {selectedRelation ? (
            <>
              <div className="workflow-graph-inspector-title">
                {selectedRelation.label || t(`team.workflow.dispatch.${selectedRelation.kind}`)}
              </div>
              <div className="workflow-graph-inspector-row">
                <span>{t('team.workflow.dispatchKind')}</span>
                <span>{t(`team.workflow.dispatch.${selectedRelation.kind}`)}</span>
              </div>
              <div className="workflow-graph-inspector-row">
                <span>{t('team.workflow.dispatchMap')}</span>
                <span>{t(`team.workflow.dispatchMapValue.${selectedRelation.kind}`)}</span>
              </div>
              <label className="workflow-graph-inspector-row">
                <span>{t('team.workflow.enabled')}</span>
                <input
                  type="checkbox"
                  checked={selectedRelation.enabled}
                  onChange={(event) => patchRelation(selectedRelation.id, { enabled: event.target.checked })}
                />
              </label>
              {selectedRelation.kind === 'review' ? (
                <>
                  <label className="workflow-graph-inspector-row">
                    <span>{t('team.workflow.reviewerType')}</span>
                    <select
                      value={selectedRelation.reviewerType ?? 'verifier'}
                      onChange={(event) =>
                        patchRelation(selectedRelation.id, { reviewerType: event.target.value as ReviewerType })
                      }
                    >
                      <option value="verifier">{t('team.workflow.reviewer.verifier')}</option>
                      <option value="inspector">{t('team.workflow.reviewer.inspector')}</option>
                      <option value="challenger">{t('team.workflow.reviewer.challenger')}</option>
                    </select>
                  </label>
                  <label className="workflow-graph-inspector-row">
                    <span>{t('team.workflow.maxReviewRounds')}</span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={selectedRelation.maxReviewRounds ?? 1}
                      onChange={(event) =>
                        patchRelation(selectedRelation.id, {
                          maxReviewRounds: Math.max(1, Number(event.target.value) || 1),
                        })
                      }
                    />
                  </label>
                  <div className="workflow-graph-reply">
                    <button
                      type="button"
                      onClick={() => spec && void persistControl(reverseReviewRelation(spec, selectedRelation.id))}
                    >
                      {t('team.workflow.reverseReview')}
                    </button>
                    <button
                      type="button"
                      onClick={() => spec && void persistControl(moveReviewOrder(spec, selectedRelation.id, -1))}
                    >
                      {t('team.workflow.reviewEarlier')}
                    </button>
                    <button
                      type="button"
                      onClick={() => spec && void persistControl(moveReviewOrder(spec, selectedRelation.id, 1))}
                    >
                      {t('team.workflow.reviewLater')}
                    </button>
                  </div>
                </>
              ) : null}
              {selectedRelation.kind === 'parallel' ? (
                <button
                  type="button"
                  onClick={() => patchRelation(selectedRelation.id, { kind: 'sequence' })}
                >
                  {t('team.workflow.makeSequence')}
                </button>
              ) : null}
              {selectedRelation.kind === 'sequence' && selectedRelation.from.kind === 'agent' ? (
                <button
                  type="button"
                  onClick={() => patchRelation(selectedRelation.id, { kind: 'parallel' })}
                >
                  {t('team.workflow.makeParallel')}
                </button>
              ) : null}
            </>
          ) : !selectedNode ? (
            <div className="workflow-graph-inspector-empty">{t('team.workflow.selectNode')}</div>
          ) : (
            <>
              <div className="workflow-graph-inspector-title">{selectedNode.label}</div>
              <div className={`workflow-graph-status ${STATUS_CLASS[selectedNode.status]}`}>
                {t(`team.workflow.status.${selectedNode.status}`)}
              </div>
              {selectedNode.kind === 'agent' && selectedNode.agent ? (
                <>
                  <div className="workflow-graph-inspector-row">
                    <span>{t('team.workflow.kind')}</span>
                    <span>{selectedNode.agent.node_type || selectedNode.agent.kind}</span>
                  </div>
                  {selectedNode.agent.human_prompt ? (
                    <p className="workflow-graph-inspector-prompt">{selectedNode.agent.human_prompt}</p>
                  ) : null}
                  {waitingAgent?.correlation_id ? (
                    <div className="workflow-graph-reply">
                      <textarea
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder={t('team.workflow.replyPlaceholder')}
                        rows={4}
                      />
                      <button type="button" disabled={replySending || !reply.trim()} onClick={() => void sendReply()}>
                        {replySending ? t('team.workflow.replySending') : t('team.workflow.replySend')}
                      </button>
                      {replyError ? <div className="workflow-graph-reply-error">{replyError}</div> : null}
                    </div>
                  ) : null}
                </>
              ) : selectedNode.kind === 'phase' ? (
                <div className="workflow-graph-inspector-row">
                  <span>{t('team.workflow.phase')}</span>
                  <span>{selectedNode.phaseId}</span>
                </div>
              ) : null}
            </>
          )}
          {saveState !== 'idle' ? (
            <div className="workflow-graph-save-state">{t(`team.workflow.save.${saveState}`)}</div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
