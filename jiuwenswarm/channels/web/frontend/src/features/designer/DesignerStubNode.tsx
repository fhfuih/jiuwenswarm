import { useEffect, useState } from 'react';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import {
  designerAssetPreviewUrl,
  designerAssetTextUrl,
  isPlaceholderAsset,
} from './designerAssetUrl';
import { useDesignerNodeActions } from './DesignerNodeActions';
import { DESIGNER_MATERIAL_SAVED_EVENT, classifyDesignerOutput } from './designerMaterials';
import type { DesignerReactFlowNode } from './designerGraphAdapter';

export type DesignerFlowNode = Node<DesignerReactFlowNode['data']>;

function outputCaption(outputRef: DesignerFlowNode['data']['outputRef']): string {
  if (!outputRef) return '';
  if (outputRef.label) return outputRef.label;
  const uri = outputRef.uri || '';
  const slash = Math.max(uri.lastIndexOf('/'), uri.lastIndexOf('\\'));
  return slash >= 0 ? decodeURIComponent(uri.slice(slash + 1)) : uri;
}

function TextThumb({ url }: { url: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = (bust = false) => {
      const href = bust ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
      void fetch(href)
        .then((response) => (response.ok ? response.text() : ''))
        .then((value) => {
          if (!cancelled) setText(value.slice(0, 180));
        })
        .catch(() => undefined);
    };
    load();
    const onSaved = () => load(true);
    window.addEventListener(DESIGNER_MATERIAL_SAVED_EVENT, onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener(DESIGNER_MATERIAL_SAVED_EVENT, onSaved);
    };
  }, [url]);
  if (!text) return null;
  return <pre className="designer-stub-node__preview-text">{text}</pre>;
}

function nodeOutputRefs(data: DesignerFlowNode['data']) {
  if (Array.isArray(data.outputRefs) && data.outputRefs.length > 0) {
    return data.outputRefs.filter((item) => item?.uri);
  }
  return data.outputRef?.uri ? [data.outputRef] : [];
}

function NodeMedia({
  data,
  nodeId,
  onInspect,
}: {
  data: DesignerFlowNode['data'];
  nodeId: string;
  onInspect: (nodeId: string, materialIndex?: number) => void;
}) {
  const refs = nodeOutputRefs(data);
  const imageTiles = refs.flatMap((ref, index) => {
    const previewUrl = designerAssetPreviewUrl(ref?.uri);
    const kind = classifyDesignerOutput({
      kind: ref?.kind || data.nodeType,
      mimeType: ref?.mime_type,
      label: ref?.label,
      placeholder: isPlaceholderAsset(ref?.uri),
      previewUrl,
    });
    if (kind !== 'image' || !previewUrl) return [];
    return [
      {
        url: previewUrl,
        label: ref?.label || `${data.label} ${index + 1}`,
      },
    ];
  });
  if (imageTiles.length > 1) {
    return (
      <div className="designer-stub-node__media-strip" data-testid="designer-node-preview-strip">
        {imageTiles.map((tile, index) => (
          <button
            key={`${tile.url}:${index}`}
            type="button"
            className="designer-stub-node__media-tile-btn nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              onInspect(nodeId, index);
            }}
          >
            <img className="designer-stub-node__media-tile" src={tile.url} alt={tile.label} />
          </button>
        ))}
      </div>
    );
  }
  const previewUrl = imageTiles[0]?.url ?? designerAssetPreviewUrl(data.outputRef?.uri);
  const textUrl = designerAssetTextUrl(data.outputRef?.uri);
  const kind = classifyDesignerOutput({
    kind: data.outputRef?.kind || data.nodeType,
    mimeType: data.outputRef?.mime_type,
    label: data.outputRef?.label,
    placeholder: isPlaceholderAsset(data.outputRef?.uri),
    previewUrl,
    textUrl,
  });
  if (kind === 'image' && previewUrl) {
    return (
      <button
        type="button"
        className="designer-stub-node__media-tile-btn nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          onInspect(nodeId, 0);
        }}
      >
        <img className="designer-stub-node__media" src={previewUrl} alt={data.label} />
      </button>
    );
  }
  if (kind === 'video' && previewUrl) {
    return (
      <video
        className="designer-stub-node__media"
        src={previewUrl}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  if (kind === 'text' && textUrl) {
    return <TextThumb url={textUrl} />;
  }
  return null;
}

export function DesignerStubNode({ id, data, selected }: NodeProps<DesignerFlowNode>) {
  const { t } = useTranslation();
  const actions = useDesignerNodeActions();
  const typeKey = `designer.nodeTypes.${data.nodeType}`;
  const typeLabel = t(typeKey, { defaultValue: data.nodeType });
  const status = data.status || 'pending';
  const statusLabel = t(`designer.runStatuses.${status}`, { defaultValue: status });
  const extraRefs = nodeOutputRefs(data);
  const caption = outputCaption(data.outputRef);
  const frameCount = extraRefs.length > 1 ? extraRefs.length : 0;
  const hasOutput = extraRefs.some((item) => item?.uri && !isPlaceholderAsset(item.uri));

  return (
    <div
      className={[
        'designer-stub-node',
        `designer-stub-node--${data.nodeType}`,
        `designer-stub-node--status-${status}`,
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="designer-stub-node"
      data-status={status}
    >
      <NodeToolbar isVisible={selected} position={Position.Top} offset={8}>
        <div className="designer-node-toolbar nodrag nopan" data-testid="designer-node-toolbar">
          <button
            type="button"
            className="btn"
            disabled={!hasOutput}
            onClick={() => actions.inspectNode(id)}
            data-testid="designer-node-inspect"
          >
            {t('designer.toolbar.inspect')}
          </button>
          {data.pendingRevision ? (
            <button
              type="button"
              className="btn"
              onClick={() => actions.openRevision(id)}
              data-testid="designer-node-compare"
            >
              {t('designer.revision.compare')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={!actions.canRerun}
            onClick={() => actions.rerunNode(id)}
            title={t('designer.toolbar.rerunHint')}
            data-testid="designer-node-rerun"
          >
            {t('designer.toolbar.rerun')}
          </button>
        </div>
      </NodeToolbar>
      <Handle type="target" position={Position.Left} className="designer-stub-node__handle" />
      <span className="designer-stub-node__type">{typeLabel}</span>
      <strong className="designer-stub-node__label">{data.label}</strong>
      <span className="designer-stub-node__status">{statusLabel}</span>
      {data.pendingRevision ? (
        <span className="designer-stub-node__pending" data-testid="designer-node-pending">
          {t('designer.revision.pending')}
        </span>
      ) : null}
      {hasOutput ? (
        <div
          className={[
            'designer-stub-node__preview',
            frameCount > 1 ? 'designer-stub-node__preview--strip' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid="designer-node-preview"
        >
          <NodeMedia data={data} nodeId={id} onInspect={actions.inspectNode} />
        </div>
      ) : null}
      {caption ? (
        <span className="designer-stub-node__output" title={data.outputRef?.uri}>
          {frameCount
            ? `${caption} · ${t('designer.materials.frameCount', { count: frameCount })}`
            : caption}
        </span>
      ) : null}
      {status === 'failed' && data.error ? (
        <span className="designer-stub-node__error" title={data.error}>
          {data.error}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} className="designer-stub-node__handle" />
    </div>
  );
}
