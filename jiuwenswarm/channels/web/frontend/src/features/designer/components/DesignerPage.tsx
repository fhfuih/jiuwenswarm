import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../../stores';
import { collectDesignerMaterials, collectPendingRevisions, preferredDesignerMaterial } from '../designerMaterials';
import { useDesignerChatStore } from '../designerChatStore';
import { bindDesignerRuntime, useDesignerRunStore } from '../designerRunStore';
import { useDesignerStore } from '../designerStore';
import { useDesignerUiStore } from '../designerUiStore';
import { DesignerMaterialViewer } from '../DesignerMaterialViewer';
import { DesignerMaterialsPanel } from '../DesignerMaterialsPanel';
import { DesignerRevisionChooser } from '../DesignerRevisionChooser';
import { DesignerCanvas } from './DesignerCanvas';
import { DesignerChatPanel, DesignerEmptyState } from './DesignerChatPanel';
import { DesignerRunControl } from './DesignerRunControl';
import '../DesignerCanvasPage.css';
import './DesignerPage.css';

type DesignerPageProps = {
  projectId?: string;
};

export function DesignerPage({ projectId }: DesignerPageProps) {
  const { t } = useTranslation();
  const selectedProject = useWorkspaceStore((state) => state.selectedProject);
  const pendingDesignerGraphId = useWorkspaceStore((state) => state.pendingDesignerGraphId);
  const setPendingDesignerGraphId = useWorkspaceStore((state) => state.setPendingDesignerGraphId);
  const designerGraphs = useWorkspaceStore((state) => state.designerGraphs);
  const effectiveProjectId = projectId || selectedProject?.project_id;

  const loadStatus = useDesignerStore((state) => state.loadStatus);
  const loadError = useDesignerStore((state) => state.loadError);
  const domainGraph = useDesignerStore((state) => state.domainGraph);
  const graphId = useDesignerStore((state) => state.graphId);
  const bootstrapInProgress = useDesignerStore((state) => state.bootstrapInProgress);
  const materialsCollapsed = useDesignerStore((state) => state.materialsCollapsed);
  const setMaterialsCollapsed = useDesignerStore((state) => state.setMaterialsCollapsed);
  const hydrateFromGraph = useDesignerChatStore((state) => state.hydrateFromGraph);
  const loadForProject = useDesignerStore((state) => state.loadForProject);
  const loadGraph = useDesignerStore((state) => state.loadGraph);
  const resetForGraph = useDesignerRunStore((state) => state.resetForGraph);
  const boundGraphId = useDesignerRunStore((state) => state.boundGraphId);
  const run = useDesignerRunStore((state) => state.run);
  const runError = useDesignerRunStore((state) => state.runError);
  const chooseOutput = useDesignerRunStore((state) => state.chooseOutput);
  const selectedMaterialId = useDesignerUiStore((state) => state.selectedMaterialId);
  const viewerOpen = useDesignerUiStore((state) => state.viewerOpen);
  const chooserNodeId = useDesignerUiStore((state) => state.chooserNodeId);
  const editRequestKey = useDesignerUiStore((state) => state.editRequestKey);
  const setSelectedMaterialId = useDesignerUiStore((state) => state.setSelectedMaterialId);
  const openViewer = useDesignerUiStore((state) => state.openViewer);
  const closeViewer = useDesignerUiStore((state) => state.closeViewer);
  const openRevision = useDesignerUiStore((state) => state.openRevision);
  const closeRevision = useDesignerUiStore((state) => state.closeRevision);
  const resetUi = useDesignerUiStore((state) => state.reset);
  const skipLoadAfterBootstrapRef = useRef(false);
  const openedMaterialsRunRef = useRef('');

  useEffect(() => bindDesignerRuntime(), []);

  useEffect(() => {
    if (pendingDesignerGraphId) {
      void loadGraph(pendingDesignerGraphId).then(() => setPendingDesignerGraphId(null));
      return;
    }
    if (bootstrapInProgress) {
      skipLoadAfterBootstrapRef.current = true;
      return;
    }
    if (skipLoadAfterBootstrapRef.current) {
      skipLoadAfterBootstrapRef.current = false;
      return;
    }
    void loadForProject(effectiveProjectId);
  }, [
    bootstrapInProgress,
    effectiveProjectId,
    loadForProject,
    loadGraph,
    pendingDesignerGraphId,
    setPendingDesignerGraphId,
  ]);

  useEffect(() => {
    if (!domainGraph) return;
    hydrateFromGraph(domainGraph, t('designer.chat.restoredPrompt'));
  }, [domainGraph, hydrateFromGraph, t]);

  useEffect(() => {
    const nextId = domainGraph?.graph_id ?? null;
    if (nextId === boundGraphId) return;
    resetUi();
    openedMaterialsRunRef.current = '';
    resetForGraph(domainGraph);
  }, [boundGraphId, domainGraph, resetForGraph, resetUi]);

  const materials = useMemo(
    () => collectDesignerMaterials(domainGraph, run),
    [domainGraph, run],
  );
  const pendingRevisions = useMemo(
    () => collectPendingRevisions(domainGraph, run),
    [domainGraph, run],
  );
  const activeRevision =
    pendingRevisions.find((item) => item.nodeId === chooserNodeId) ?? pendingRevisions[0];

  useEffect(() => {
    if (run?.status !== 'completed' || !run.run_id || materials.length === 0) return;
    if (openedMaterialsRunRef.current === run.run_id) return;
    const preferred = preferredDesignerMaterial(materials);
    if (preferred) setSelectedMaterialId(preferred.id || preferred.nodeId);
    openedMaterialsRunRef.current = run.run_id;
    if (pendingRevisions[0]) openRevision(pendingRevisions[0].nodeId);
  }, [materials, openRevision, pendingRevisions, run, setSelectedMaterialId]);

  const showCanvas = loadStatus === 'ready' && domainGraph;
  const showEmpty = loadStatus === 'empty';
  const showError = loadStatus === 'error';
  const showLoading =
    loadStatus === 'loading' || loadStatus === 'idle' || loadStatus === 'bootstrapping';

  const projectTitle =
    domainGraph?.title?.trim() ||
    (showLoading || showEmpty || showError ? '' : t('designer.subtitle'));

  return (
    <div className="designer-page app-section" data-testid="designer-page">
      <header className="designer-page__toolbar" data-testid="designer-page-toolbar">
        <div className="designer-page__heading">
          <h1 className="designer-page__title" data-testid="designer-page-rail-title">
            {t('nav.designer')}
          </h1>
          <p className="designer-page__subtitle" data-testid="designer-page-title">
            {projectTitle || t('designer.subtitle')}
          </p>
        </div>
        {designerGraphs.length > 0 ? (
          <label className="designer-page__recent">
            <span>{t('designer.recentGraphs')}</span>
            <select
              value={graphId || ''}
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
        <div className="designer-page__toolbar-actions">
          <DesignerRunControl
            graph={showCanvas ? domainGraph : null}
            disabled={!showCanvas}
          />
        </div>
      </header>
      {runError ? (
        <p className="designer-page__error" data-testid="designer-error">
          {runError}
        </p>
      ) : null}

      <div className="designer-page__workspace">
        <DesignerChatPanel />

        {showCanvas ? <DesignerCanvas graph={domainGraph} /> : null}

        {showCanvas ? (
          <div
            className={`designer-page__materials${materialsCollapsed ? ' designer-page__materials--collapsed' : ''}`}
            data-collapsed={materialsCollapsed ? 'true' : 'false'}
          >
            <DesignerMaterialsPanel
              materials={materials}
              selectedId={selectedMaterialId}
              pendingNodeId={pendingRevisions[0]?.nodeId}
              collapsed={materialsCollapsed}
              onToggleCollapsed={() => setMaterialsCollapsed(!materialsCollapsed)}
              onSelect={setSelectedMaterialId}
              onOpenViewer={openViewer}
              onCompare={openRevision}
            />
          </div>
        ) : null}

        {showLoading ? (
          <div className="designer-page__state" data-testid="designer-loading-state">
            <div className="designer-page__state-card">
              <Loader2 className="mx-auto mb-3 animate-spin" size={24} aria-hidden />
              <p className="designer-page__state-desc">
                {loadStatus === 'bootstrapping' ? t('designer.chat.thinking') : t('designer.loading')}
              </p>
            </div>
          </div>
        ) : null}

        {showEmpty ? <DesignerEmptyState variant="empty" /> : null}
        {showError ? <DesignerEmptyState variant="error" errorMessage={loadError} /> : null}
      </div>

      {viewerOpen ? (
        <DesignerMaterialViewer
          materials={materials}
          selectedId={selectedMaterialId}
          startEditKey={editRequestKey}
          onSelect={setSelectedMaterialId}
          onClose={closeViewer}
        />
      ) : null}
      {activeRevision && chooserNodeId ? (
        <DesignerRevisionChooser
          revision={activeRevision}
          busy={Boolean(run?.status === 'running')}
          onChoose={(choice) => {
            void chooseOutput(activeRevision.nodeId, choice).then(() => closeRevision());
          }}
          onClose={closeRevision}
        />
      ) : null}
    </div>
  );
}
