import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collectDesignerMaterials,
  hasPendingDesignerRevision,
  isEditableDesignerMaterial,
} from '../../designerMaterials';
import { useDesignerRunStore } from '../../designerRunStore';
import { useDesignerStore } from '../../designerStore';
import { useDesignerUiStore } from '../../designerUiStore';
import { isTextLikeNodeType } from '../../mediaNodeConfig';

type DesignerNodeToolbarProps = {
  nodeId: string;
  nodeType: string;
};

export function DesignerNodeToolbar({ nodeId, nodeType }: DesignerNodeToolbarProps) {
  const { t } = useTranslation();
  const domainGraph = useDesignerStore((state) => state.domainGraph);
  const run = useDesignerRunStore((state) => state.run);
  const isRunning = useDesignerRunStore((state) => state.isRunning);
  const rerunNode = useDesignerRunStore((state) => state.rerunNode);
  const nodeState = useDesignerRunStore((state) => state.nodeStates[nodeId]);
  const inspectNode = useDesignerUiStore((state) => state.inspectNode);
  const startEdit = useDesignerUiStore((state) => state.startEdit);
  const openRevision = useDesignerUiStore((state) => state.openRevision);

  const materials = collectDesignerMaterials(domainGraph, run);
  const material =
    materials.find((item) => item.id.startsWith(`${nodeId}:`)) ??
    materials.find((item) => item.nodeId === nodeId);
  const hasOutput = Boolean(material && !material.placeholder && (material.previewUrl || material.textUrl));
  const canEdit = Boolean(material && isEditableDesignerMaterial(material));
  const pendingRevision = hasPendingDesignerRevision(nodeState);
  const canRerun = Boolean(domainGraph && !isRunning);

  const onInspect = useCallback(() => {
    inspectNode(nodeId);
  }, [inspectNode, nodeId]);

  const onEdit = useCallback(() => {
    startEdit(material?.id || nodeId);
  }, [material?.id, nodeId, startEdit]);

  const onRerun = useCallback(() => {
    if (!domainGraph) return;
    void rerunNode(domainGraph, nodeId);
  }, [domainGraph, nodeId, rerunNode]);

  return (
    <div
      className="designer-node-toolbar designer-node-toolbar--legacy nodrag nopan"
      data-testid="designer-node-toolbar"
      data-node-type={nodeType}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="btn"
        disabled={!hasOutput}
        onClick={onInspect}
        data-testid="designer-node-inspect"
      >
        {t('designer.toolbar.inspect')}
      </button>
      {isTextLikeNodeType(nodeType) ? (
        <button
          type="button"
          className="btn"
          disabled={!canEdit}
          onClick={onEdit}
          data-testid="designer-node-edit"
        >
          {t('designer.materials.edit')}
        </button>
      ) : null}
      {pendingRevision ? (
        <button
          type="button"
          className="btn"
          onClick={() => openRevision(nodeId)}
          data-testid="designer-node-compare"
        >
          {t('designer.revision.compare')}
        </button>
      ) : null}
      <button
        type="button"
        className="btn"
        disabled={!canRerun}
        onClick={onRerun}
        title={t('designer.toolbar.rerunHint')}
        data-testid="designer-node-rerun"
      >
        {t('designer.toolbar.rerun')}
      </button>
    </div>
  );
}
