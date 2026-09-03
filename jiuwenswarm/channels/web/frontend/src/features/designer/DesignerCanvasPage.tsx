import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { webClient } from '../../services/webClient';
import { useWorkspaceStore } from '../../stores';
import { fromReactFlowGraph, toReactFlowGraph } from './designerGraphAdapter';
import { designerGraphClient } from './designerGraphClient';
import { DesignerNodeActionsContext } from './DesignerNodeActions';
import {
  collectDesignerMaterials,
  collectPendingRevisions,
  preferredDesignerMaterial,
} from './designerMaterials';
import { DesignerMaterialViewer } from './DesignerMaterialViewer';
import { DesignerMaterialsPanel } from './DesignerMaterialsPanel';
import { DesignerRevisionChooser } from './DesignerRevisionChooser';
import { isActiveDesignerRun, mergeRunStatesIntoNodes } from './designerRunView';
import { DesignerStubNode, type DesignerFlowNode } from './DesignerStubNode';
import type {
  DesignerExecutionGraph,
  DesignerExecutionRun,
  DesignerGraphSummary,
} from './executionGraphTypes';
import fixtureGraph from './fixtures/designer-execution-graph.v1.json';
import './DesignerCanvasPage.css';

const nodeTypes: NodeTypes = {
  text: DesignerStubNode,
  table: DesignerStubNode,
  image: DesignerStubNode,
  video: DesignerStubNode,
  audio: DesignerStubNode,
};

function toFlowGraph(graph: DesignerExecutionGraph): {
  nodes: DesignerFlowNode[];
  edges: Edge[];
} {
  const mapped = toReactFlowGraph(graph);
  return {
    nodes: mapped.nodes.map((node) => ({
      ...node,
      type: node.type,
    })),
    edges: mapped.edges.map((edge) => ({
      ...edge,
      type: edge.type ?? 'smoothstep',
    })),
  };
}

function flowToAdapterGraph(nodes: DesignerFlowNode[], edges: Edge[]) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type ?? 'text',
      position: node.position,
      data: node.data,
      style: {
        width: typeof node.style?.width === 'number' ? node.style.width : undefined,
        height: typeof node.style?.height === 'number' ? node.style.height : undefined,
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: typeof edge.label === 'string' ? edge.label : undefined,
    })),
  };
}

function FitViewOnGraph({ revision }: { revision: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (revision === 0) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fitView, revision]);
  return null;
}

export function DesignerCanvasPage() {
  const { t } = useTranslation();
  const selectedProject = useWorkspaceStore((state) => state.selectedProject);
  const workMode = useWorkspaceStore((state) => state.workMode);
  const loadProjects = useWorkspaceStore((state) => state.loadProjects);
  const pendingDesignerGraphId = useWorkspaceStore((state) => state.pendingDesignerGraphId);
  const setPendingDesignerGraphId = useWorkspaceStore((state) => state.setPendingDesignerGraphId);
  const designerGraphs = useWorkspaceStore((state) => state.designerGraphs);

  const [prompt, setPrompt] = useState('');
  const [graphTitle, setGraphTitle] = useState('');
  const [graphId, setGraphId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [revision, setRevision] = useState(0);
  const [runId, setRunId] = useState('');
  const [runStatus, setRunStatus] = useState('');
  const [activeRun, setActiveRun] = useState<DesignerExecutionRun | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [chooserNodeId, setChooserNodeId] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState<DesignerFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const domainGraphRef = useRef<DesignerExecutionGraph | null>(null);
  const runIdRef = useRef('');
  const activeRunRef = useRef<DesignerExecutionRun | null>(null);
  const openedMaterialsRunRef = useRef('');
  const persistChainRef = useRef(Promise.resolve());
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const sampleGraph = useMemo(() => fixtureGraph as DesignerExecutionGraph, []);
  const isEmpty = nodes.length === 0;
  const materials = useMemo(
    () => collectDesignerMaterials(domainGraphRef.current, activeRun),
    [activeRun, revision],
  );
  const pendingRevisions = useMemo(
    () => collectPendingRevisions(domainGraphRef.current, activeRun),
    [activeRun, revision],
  );
  const activeRevision =
    pendingRevisions.find((item) => item.nodeId === chooserNodeId) ?? pendingRevisions[0];

  const applyRun = useCallback(
    (run: DesignerExecutionRun) => {
      runIdRef.current = run.run_id;
      activeRunRef.current = run;
      setRunId(run.run_id);
      setRunStatus(run.status);
      setActiveRun(run);
      setNodes((current) => mergeRunStatesIntoNodes(current, run));
      if (run.status === 'completed') setStatus(t('designer.runCompleted'));
      if (run.status === 'failed') setStatus(t('designer.runFailed'));
      if (run.status === 'cancelled') setStatus(t('designer.runCancelled'));
      if (run.status === 'paused') setStatus(t('designer.runPaused'));
      if (run.status === 'running') setStatus(t('designer.runStarted'));
    },
    [setNodes, t],
  );

  const applyGraph = useCallback(
    (graph: DesignerExecutionGraph, nextPersisted: boolean) => {
      const next = toFlowGraph(graph);
      domainGraphRef.current = graph;
      runIdRef.current = '';
      activeRunRef.current = null;
      openedMaterialsRunRef.current = '';
      setPersisted(nextPersisted);
      setRunId('');
      setRunStatus('');
      setActiveRun(null);
      setSelectedMaterialId('');
      setViewerOpen(false);
      setChooserNodeId('');
      setGraphTitle(graph.title);
      setGraphId(graph.graph_id);
      setNodes(next.nodes);
      setEdges(next.edges);
      setRevision((value) => value + 1);
    },
    [setEdges, setNodes],
  );

  const applyGraphStructure = useCallback(
    (graph: DesignerExecutionGraph) => {
      const next = toFlowGraph(graph);
      domainGraphRef.current = graph;
      setPersisted(true);
      setGraphTitle(graph.title);
      setGraphId(graph.graph_id);
      const run = activeRunRef.current;
      setNodes(run ? mergeRunStatesIntoNodes(next.nodes, run) : next.nodes);
      setEdges(next.edges);
      setRevision((value) => value + 1);
    },
    [setEdges, setNodes],
  );

  const loadSample = useCallback(() => {
    setError('');
    setStatus('');
    applyGraph(sampleGraph, false);
  }, [applyGraph, sampleGraph]);

  const openSavedGraph = useCallback(
    async (graph: DesignerExecutionGraph) => {
      applyGraph(graph, true);
      try {
        const result = await designerGraphClient.getRun({ graphId: graph.graph_id });
        applyRun(result.run);
      } catch {
        // Graph exists but has not been run yet.
      }
    },
    [applyGraph, applyRun],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (pendingDesignerGraphId) {
          const result = await designerGraphClient.get(pendingDesignerGraphId);
          if (cancelled) return;
          await openSavedGraph(result.graph);
          setPendingDesignerGraphId(null);
          return;
        }
        const current = domainGraphRef.current;
        const projectId = selectedProject?.project_id;
        if (
          current &&
          (!projectId ||
            projectId === 'default' ||
            projectId === 'default_code' ||
            current.project_id === projectId)
        ) {
          return;
        }
        const listed = await designerGraphClient.list(
          projectId && projectId !== 'default' && projectId !== 'default_code'
            ? projectId
            : undefined,
        );
        if (cancelled) return;
        const summaries = listed.summaries || [];
        const preferred =
          summaries.find((item: DesignerGraphSummary) => item.has_video) ??
          summaries[0] ??
          listed.graphs[0];
        const graph = preferred
          ? listed.graphs.find((item) => item.graph_id === preferred.graph_id) ?? listed.graphs[0]
          : undefined;
        if (!graph) return;
        await openSavedGraph(graph);
      } catch {
        // No saved graphs yet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    applyGraph,
    openSavedGraph,
    pendingDesignerGraphId,
    selectedProject?.project_id,
    setPendingDesignerGraphId,
  ]);

  const clearCanvas = useCallback(() => {
    domainGraphRef.current = null;
    runIdRef.current = '';
    activeRunRef.current = null;
    openedMaterialsRunRef.current = '';
    setPersisted(false);
    setRunId('');
    setRunStatus('');
    setActiveRun(null);
    setSelectedMaterialId('');
    setViewerOpen(false);
    setGraphTitle('');
    setGraphId('');
    setStatus('');
    setError('');
    setNodes([]);
    setEdges([]);
  }, [setEdges, setNodes]);

  const startRun = useCallback(async () => {
    const graphId = domainGraphRef.current?.graph_id;
    if (!graphId || !persisted) return;
    setBusy(true);
    setError('');
    try {
      const result = await designerGraphClient.startRun({ graphId });
      applyRun(result.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('designer.errors.runFailed'));
    } finally {
      setBusy(false);
    }
  }, [applyRun, persisted, t]);

  const pauseRun = useCallback(async () => {
    if (!runId) return;
    try {
      const result = await designerGraphClient.pauseRun(runId);
      applyRun(result.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('designer.errors.runFailed'));
    }
  }, [applyRun, runId, t]);

  const cancelRun = useCallback(async () => {
    if (!runId) return;
    try {
      const result = await designerGraphClient.cancelRun(runId);
      applyRun(result.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('designer.errors.runFailed'));
    }
  }, [applyRun, runId, t]);

  useEffect(() => {
    if (!runId || !isActiveDesignerRun(runStatus)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await designerGraphClient.getRun({ runId });
        if (!cancelled) applyRun(result.run);
      } catch {
        // Keep the last painted state; the next tick retries.
      }
    };
    const timer = window.setInterval(() => {
      void tick();
    }, 400);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyRun, runId, runStatus]);

  useEffect(() => {
    const matchesRun = (run?: DesignerExecutionRun) =>
      Boolean(
        run?.run_id &&
          (run.run_id === runIdRef.current || run.graph_id === domainGraphRef.current?.graph_id),
      );
    const offRun = webClient.on('designer.run.updated', ({ payload }) => {
      const run = (payload as { run?: DesignerExecutionRun }).run ?? (payload as DesignerExecutionRun);
      if (matchesRun(run)) applyRun(run);
    });
    const offNode = webClient.on('designer.node.updated', ({ payload }) => {
      const run = (payload as { run?: DesignerExecutionRun }).run;
      if (matchesRun(run)) applyRun(run as DesignerExecutionRun);
    });
    const offGraph = webClient.on('designer.graph.updated', ({ payload }) => {
      const graph = (payload as { graph?: DesignerExecutionGraph }).graph;
      if (!graph?.graph_id || graph.graph_id !== domainGraphRef.current?.graph_id) return;
      applyGraphStructure(graph);
    });
    return () => {
      offRun();
      offNode();
      offGraph();
    };
  }, [applyGraphStructure, applyRun]);

  const generateGraph = useCallback(async () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      setError(t('designer.errors.promptRequired'));
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const projectId = selectedProject?.project_id;
      const useExistingProject = Boolean(
        projectId && projectId !== 'default' && projectId !== 'default_code',
      );
      const result = await designerGraphClient.bootstrap({
        prompt: nextPrompt,
        title: nextPrompt.slice(0, 80),
        ...(useExistingProject ? { projectId } : { workMode }),
      });
      applyGraph(result.graph, true);
      if (result.project) {
        void loadProjects();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('designer.errors.generateFailed'));
    } finally {
      setBusy(false);
    }
  }, [applyGraph, loadProjects, prompt, selectedProject?.project_id, t, workMode]);

  const persistLayout = useCallback(
    (nextNodes: DesignerFlowNode[], nextEdges: Edge[]) => {
      const domain = domainGraphRef.current;
      if (!domain || !persisted) return;
      const nextGraph = fromReactFlowGraph(flowToAdapterGraph(nextNodes, nextEdges), domain);
      domainGraphRef.current = nextGraph;
      persistChainRef.current = persistChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await designerGraphClient.save(nextGraph);
          domainGraphRef.current = saved.graph;
          setStatus(t('designer.layoutSaved'));
          setError('');
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : t('designer.errors.saveFailed'));
        });
    },
    [persisted, t],
  );

  const handleNodeDragStop: OnNodeDrag<DesignerFlowNode> = useCallback(
    (_event, node) => {
      const nextNodes = nodesRef.current.map((item) =>
        item.id === node.id ? { ...item, position: node.position } : item,
      );
      persistLayout(nextNodes, edgesRef.current);
    },
    [persistLayout],
  );

  const handleNodeClick = useCallback((_event: MouseEvent, node: Node) => {
    setSelectedMaterialId(node.id);
  }, []);

  const openViewer = useCallback((id: string) => {
    setSelectedMaterialId(id);
    setViewerOpen(true);
  }, []);

  const openRevision = useCallback((nodeId: string) => {
    setChooserNodeId(nodeId);
  }, []);

  const chooseRevision = useCallback(
    async (choice: 'original' | 'new') => {
      if (!runId || !activeRevision) return;
      setBusy(true);
      setError('');
      try {
        const result = await designerGraphClient.chooseOutput({
          runId,
          nodeId: activeRevision.nodeId,
          choice,
        });
        applyRun(result.run);
        setChooserNodeId('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('designer.errors.chooseFailed'));
      } finally {
        setBusy(false);
      }
    },
    [activeRevision, applyRun, runId, t],
  );

  const inspectNode = useCallback(
    (nodeId: string, materialIndex?: number) => {
      const id =
        typeof materialIndex === 'number'
          ? `${nodeId}:${materialIndex}`
          : materials.find((item) => item.nodeId === nodeId)?.id || nodeId;
      openViewer(id);
    },
    [materials, openViewer],
  );

  const rerunNode = useCallback(
    async (nodeId: string) => {
      const graphId = domainGraphRef.current?.graph_id;
      if (!graphId || !persisted) return;
      setBusy(true);
      setError('');
      try {
        const result = await designerGraphClient.startRun({ graphId, nodeId });
        applyRun(result.run);
        setSelectedMaterialId(nodeId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('designer.errors.rerunFailed'));
      } finally {
        setBusy(false);
      }
    },
    [applyRun, persisted, t],
  );

  const nodeActions = useMemo(
    () => ({
      inspectNode,
      rerunNode: (nodeId: string) => {
        void rerunNode(nodeId);
      },
      openRevision,
      canRerun: persisted && !busy && !isActiveDesignerRun(runStatus),
    }),
    [busy, inspectNode, openRevision, persisted, rerunNode, runStatus],
  );

  useEffect(() => {
    if (runStatus !== 'completed' || !runId || materials.length === 0) return;
    if (openedMaterialsRunRef.current === runId) return;
    const preferred = preferredDesignerMaterial(materials);
    if (preferred) setSelectedMaterialId(preferred.id || preferred.nodeId);
    openedMaterialsRunRef.current = runId;
    if (pendingRevisions[0]) setChooserNodeId(pendingRevisions[0].nodeId);
  }, [materials, pendingRevisions, runId, runStatus]);

  return (
    <div className="designer-canvas-page" data-testid="designer-canvas-page">
      <header className="designer-canvas-page__toolbar">
        <div className="designer-canvas-page__heading">
          <h1 className="designer-canvas-page__title">{t('designer.title')}</h1>
          <p className="designer-canvas-page__subtitle">
            {graphTitle || t('designer.subtitle')}
          </p>
        </div>
        {designerGraphs.length > 0 ? (
          <label className="designer-canvas-page__recent">
            <span>{t('designer.recentGraphs')}</span>
            <select
              className="designer-canvas-page__prompt-input"
              value={graphId}
              onChange={(event) => {
                const nextId = event.target.value;
                if (nextId) setPendingDesignerGraphId(nextId);
              }}
              data-testid="designer-recent-graphs"
            >
              {designerGraphs.map((item) => (
                <option key={item.graph_id} value={item.graph_id}>
                  {item.has_video
                    ? `${item.title} · ${t('designer.hasVideo')}`
                    : item.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <form
          className="designer-canvas-page__prompt"
          onSubmit={(event) => {
            event.preventDefault();
            void generateGraph();
          }}
        >
          <input
            className="designer-canvas-page__prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('designer.promptPlaceholder')}
            disabled={busy}
            data-testid="designer-prompt-input"
          />
          <button
            type="submit"
            className="btn primary"
            disabled={busy || !prompt.trim()}
            data-testid="designer-generate"
          >
            {busy ? t('designer.generating') : t('designer.generate')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={loadSample}
            disabled={busy}
            data-testid="designer-load-fixture"
          >
            {t('designer.loadFixture')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={clearCanvas}
            disabled={busy || isEmpty}
            data-testid="designer-clear-canvas"
          >
            {t('designer.clearCanvas')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void startRun()}
            disabled={busy || !persisted || isActiveDesignerRun(runStatus)}
            data-testid="designer-run"
          >
            {t('designer.run')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void pauseRun()}
            disabled={!runId || runStatus !== 'running'}
            data-testid="designer-pause"
          >
            {t('designer.pause')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void cancelRun()}
            disabled={!runId || !isActiveDesignerRun(runStatus)}
            data-testid="designer-cancel"
          >
            {t('designer.cancel')}
          </button>
        </form>
        {error ? (
          <p className="designer-canvas-page__error" data-testid="designer-error">
            {error}
          </p>
        ) : status ? (
          <p className="designer-canvas-page__status" data-testid="designer-status">
            {status}
          </p>
        ) : null}
      </header>

      <div className="designer-canvas-page__body">
        <div className="designer-canvas-page__stage">
          <DesignerNodeActionsContext.Provider value={nodeActions}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onNodeDragStop={handleNodeDragStop}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.4}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <FitViewOnGraph revision={revision} />
              <Background gap={20} size={1} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </DesignerNodeActionsContext.Provider>
          {isEmpty ? (
            <div className="designer-canvas-page__empty" data-testid="designer-canvas-empty">
              <strong>{t('designer.emptyTitle')}</strong>
              <p>{t('designer.emptyHint')}</p>
            </div>
          ) : null}
        </div>
        {materials.length > 0 ? (
          <DesignerMaterialsPanel
            materials={materials}
            selectedId={selectedMaterialId}
            pendingNodeId={pendingRevisions[0]?.nodeId}
            onSelect={setSelectedMaterialId}
            onOpenViewer={openViewer}
            onCompare={openRevision}
          />
        ) : null}
      </div>
      {viewerOpen ? (
        <DesignerMaterialViewer
          materials={materials}
          selectedId={selectedMaterialId}
          onSelect={setSelectedMaterialId}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
      {activeRevision && chooserNodeId ? (
        <DesignerRevisionChooser
          revision={activeRevision}
          busy={busy}
          onChoose={(choice) => {
            void chooseRevision(choice);
          }}
          onClose={() => setChooserNodeId('')}
        />
      ) : null}
    </div>
  );
}
