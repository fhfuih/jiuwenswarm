import {
  FileText,
  Headphones,
  Image as ImageIcon,
  Loader2,
  Sheet,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  DESIGNER_FAKE_TABLE,
  DESIGNER_FAKE_TEXT,
  getCachedFakeImageUrl,
  getCachedFakeVideoUrl,
} from '../../designerFakeAssets';
import { designerAssetPreviewUrl, designerAssetTextUrl } from '../../designerAssetUrl';
import { DESIGNER_MATERIAL_SAVED_EVENT } from '../../designerMaterials';
import {
  DESIGNER_NODE_STATUS_COMPLETED,
  DESIGNER_NODE_STATUS_FAILED,
  DESIGNER_NODE_STATUS_RUNNING,
  DESIGNER_NODE_TYPE_AUDIO,
  DESIGNER_NODE_TYPE_IMAGE,
  DESIGNER_NODE_TYPE_TABLE,
  DESIGNER_NODE_TYPE_TEXT,
  DESIGNER_NODE_TYPE_VIDEO,
} from '../../executionGraphTypes';
import type { DesignerReactFlowNode } from '../../designerGraphAdapter';
import { useDesignerRunStore } from '../../designerRunStore';
import { useDesignerStore } from '../../designerStore';
import { isMediaNodeType, supportsNodeToolbar } from '../../mediaNodeConfig';
import { DesignerNodeToolbar } from '../controls/DesignerNodeToolbar';

type DesignerNodeData = DesignerReactFlowNode['data'];
type DesignerFlowNode = Node<DesignerNodeData>;

function modalityIcon(nodeType: string): LucideIcon {
  switch (nodeType) {
    case DESIGNER_NODE_TYPE_TABLE:
      return Sheet;
    case DESIGNER_NODE_TYPE_IMAGE:
      return ImageIcon;
    case DESIGNER_NODE_TYPE_VIDEO:
      return Video;
    case DESIGNER_NODE_TYPE_AUDIO:
      return Headphones;
    case DESIGNER_NODE_TYPE_TEXT:
    default:
      return FileText;
  }
}

function PlaceholderBody({ nodeType }: { nodeType: string }) {
  const Icon = modalityIcon(nodeType);
  return (
    <span className="designer-node__placeholder" data-testid="designer-node-placeholder" data-node-type={nodeType}>
      <Icon className="designer-node__placeholder-icon" size={40} strokeWidth={1.5} aria-hidden />
    </span>
  );
}

function DesignerNodeShell({
  nodeId,
  label,
  nodeType,
  body,
  media = false,
  selected = false,
  toolbar = null,
}: {
  nodeId: string;
  label: string;
  nodeType: string;
  body: ReactNode;
  media?: boolean;
  selected?: boolean;
  toolbar?: ReactNode;
}) {
  const status = useDesignerRunStore(
    (state) => state.nodeStates[nodeId]?.status ?? 'pending',
  );
  const statusClass =
    status === DESIGNER_NODE_STATUS_RUNNING
      ? ' is-running'
      : status === DESIGNER_NODE_STATUS_COMPLETED
        ? ' is-completed'
        : status === DESIGNER_NODE_STATUS_FAILED
          ? ' is-failed'
          : '';
  const TypeIcon = modalityIcon(nodeType);
  const showMediaFill = media && status === DESIGNER_NODE_STATUS_COMPLETED;

  return (
    <div
      className={`designer-node${media ? ' designer-node--media' : ''}${showMediaFill ? ' designer-node--media-filled' : ''}${selected ? ' is-selected' : ''}${statusClass} group`}
      data-testid="designer-node"
      data-selected={selected ? 'true' : 'false'}
      data-status={status}
    >
      <Handle type="target" position={Position.Left} className='size-2 bg-gray-500 transition-all ease-out group-hover:size-3' />
      <div className="designer-node__header">
        <span className="designer-node__type-icon" aria-hidden data-testid="designer-node-type-icon" data-node-type={nodeType}>
          <TypeIcon size={14} strokeWidth={1.75} />
        </span>
        <span className="designer-node__label">{label}</span>
      </div>
      <div className="designer-node__body">{body}</div>
      <Handle type="source" position={Position.Right} className='size-2 bg-gray-500 transition-all ease-out group-hover:size-3' />
      {toolbar}
    </div>
  );
}

function RunningBody() {
  return (
    <span className="designer-node__running" data-testid="designer-node-running">
      <Loader2 className="designer-node__running-icon" size={22} aria-hidden />
    </span>
  );
}

function FakeTableBody() {
  return (
    <table className="designer-node__table" data-testid="designer-node-fake-table">
      <thead>
        <tr>
          {DESIGNER_FAKE_TABLE.headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DESIGNER_FAKE_TABLE.rows.map((row) => (
          <tr key={row.join('|')}>
            {row.map((cell) => (
              <td key={`${row[0]}-${cell}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutputTextBody({ uri, fallback }: { uri: string | null; fallback: string }) {
  const [text, setText] = useState('');
  const textUrl = designerAssetTextUrl(uri);
  useEffect(() => {
    if (!textUrl) {
      setText('');
      return;
    }
    let cancelled = false;
    const load = (bust = false) => {
      const href = bust ? `${textUrl}${textUrl.includes('?') ? '&' : '?'}t=${Date.now()}` : textUrl;
      void fetch(href)
        .then((response) => (response.ok ? response.text() : ''))
        .then((value) => {
          if (!cancelled) setText(value.slice(0, 240));
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
  }, [textUrl]);
  return (
    <p className="designer-node__text" data-testid="designer-node-text">
      {text || fallback}
    </p>
  );
}

function useNodeOutputUri(nodeId: string): string | null {
  const runUri = useDesignerRunStore((state) => state.nodeStates[nodeId]?.output_ref?.uri ?? null);
  const graphUri = useDesignerStore(
    (state) => state.domainGraph?.nodes.find((node) => node.id === nodeId)?.output_ref?.uri ?? null,
  );
  return runUri || graphUri;
}

function nodeToolbar(nodeId: string, nodeType: string, selected?: boolean) {
  if (!supportsNodeToolbar(nodeType)) return null;
  return (
    <NodeToolbar
      isVisible={selected}
      position={Position.Bottom}
      offset={16}
      align="center"
      className="designer-node-toolbar-portal"
    >
      <DesignerNodeToolbar nodeId={nodeId} nodeType={nodeType} />
    </NodeToolbar>
  );
}

export function DesignerTextNode({ id, data, selected }: NodeProps<DesignerFlowNode>) {
  const nodeData = data as DesignerNodeData;
  const status = useDesignerRunStore((state) => state.nodeStates[id]?.status ?? 'pending');
  const outputUri = useNodeOutputUri(id);
  const body =
    status === DESIGNER_NODE_STATUS_RUNNING ? (
      <RunningBody />
    ) : status === DESIGNER_NODE_STATUS_COMPLETED || outputUri ? (
      <OutputTextBody uri={outputUri} fallback={DESIGNER_FAKE_TEXT} />
    ) : (
      <PlaceholderBody nodeType={DESIGNER_NODE_TYPE_TEXT} />
    );

  return (
    <DesignerNodeShell
      nodeId={id}
      label={nodeData.label}
      nodeType={DESIGNER_NODE_TYPE_TEXT}
      selected={selected}
      body={body}
      toolbar={nodeToolbar(id, DESIGNER_NODE_TYPE_TEXT, selected)}
    />
  );
}

export function DesignerTableNode({ id, data, selected }: NodeProps<DesignerFlowNode>) {
  const nodeData = data as DesignerNodeData;
  const status = useDesignerRunStore((state) => state.nodeStates[id]?.status ?? 'pending');
  const outputUri = useNodeOutputUri(id);
  const textUrl = designerAssetTextUrl(outputUri);
  const body =
    status === DESIGNER_NODE_STATUS_RUNNING ? (
      <RunningBody />
    ) : status === DESIGNER_NODE_STATUS_COMPLETED || outputUri ? (
      textUrl ? (
        <OutputTextBody uri={outputUri} fallback="" />
      ) : (
        <FakeTableBody />
      )
    ) : (
      <PlaceholderBody nodeType={DESIGNER_NODE_TYPE_TABLE} />
    );

  return (
    <DesignerNodeShell
      nodeId={id}
      label={nodeData.label}
      nodeType={DESIGNER_NODE_TYPE_TABLE}
      selected={selected}
      body={body}
      toolbar={nodeToolbar(id, DESIGNER_NODE_TYPE_TABLE, selected)}
    />
  );
}

export function DesignerMediaNode({ id, data, selected }: NodeProps<DesignerFlowNode>) {
  const nodeData = data as DesignerNodeData;
  const nodeType = nodeData.nodeType;
  const status = useDesignerRunStore((state) => state.nodeStates[id]?.status ?? 'pending');
  const outputUri = useNodeOutputUri(id);

  let body: ReactNode;
  if (status === DESIGNER_NODE_STATUS_RUNNING) {
    body = <RunningBody />;
  } else if (status === DESIGNER_NODE_STATUS_COMPLETED && nodeType === DESIGNER_NODE_TYPE_IMAGE) {
    const src = designerAssetPreviewUrl(outputUri) || getCachedFakeImageUrl();
    body = src ? (
      <img
        className="designer-node__media-preview"
        src={src}
        alt={nodeData.label}
        draggable={false}
        data-testid="designer-node-image"
      />
    ) : (
      <PlaceholderBody nodeType={nodeType} />
    );
  } else if (status === DESIGNER_NODE_STATUS_COMPLETED && nodeType === DESIGNER_NODE_TYPE_VIDEO) {
    const src = designerAssetPreviewUrl(outputUri) || getCachedFakeVideoUrl();
    body = src ? (
      <video
        className="designer-node__media-preview"
        src={src}
        muted
        playsInline
        preload="metadata"
        controls={false}
        autoPlay={false}
        disablePictureInPicture
        controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"
        draggable={false}
        data-testid="designer-node-video"
      />
    ) : (
      <PlaceholderBody nodeType={nodeType} />
    );
  } else if (status === DESIGNER_NODE_STATUS_COMPLETED && nodeType === DESIGNER_NODE_TYPE_AUDIO) {
    body = <PlaceholderBody nodeType={DESIGNER_NODE_TYPE_AUDIO} />;
  } else {
    body = <PlaceholderBody nodeType={nodeType} />;
  }

  return (
    <DesignerNodeShell
      nodeId={id}
      label={nodeData.label}
      nodeType={nodeType}
      media={isMediaNodeType(nodeType)}
      selected={selected}
      body={body}
      toolbar={nodeToolbar(id, nodeType, selected)}
    />
  );
}

export const designerNodeTypes = {
  [DESIGNER_NODE_TYPE_TEXT]: DesignerTextNode,
  [DESIGNER_NODE_TYPE_TABLE]: DesignerTableNode,
  [DESIGNER_NODE_TYPE_IMAGE]: DesignerMediaNode,
  [DESIGNER_NODE_TYPE_VIDEO]: DesignerMediaNode,
  [DESIGNER_NODE_TYPE_AUDIO]: DesignerMediaNode,
};
