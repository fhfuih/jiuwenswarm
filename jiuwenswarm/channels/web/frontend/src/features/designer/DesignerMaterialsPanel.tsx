import { useTranslation } from 'react-i18next';
import { DesignerTextEditor } from './DesignerTextEditor';
import { classifyDesignerOutput, isEditableDesignerMaterial, type DesignerMaterial } from './designerMaterials';

type DesignerMaterialsPanelProps = {
  materials: DesignerMaterial[];
  selectedId: string;
  pendingNodeId?: string;
  onSelect: (nodeId: string) => void;
  onOpenViewer: (id: string) => void;
  onCompare?: (nodeId: string) => void;
};

function previewKind(material: DesignerMaterial) {
  return classifyDesignerOutput(material);
}

export function DesignerMaterialsPanel({
  materials,
  selectedId,
  pendingNodeId,
  onSelect,
  onOpenViewer,
  onCompare,
}: DesignerMaterialsPanelProps) {
  const { t } = useTranslation();
  const selected =
    materials.find((item) => item.id === selectedId) ??
    materials.find((item) => item.nodeId === selectedId) ??
    materials[0];
  const kind = selected ? previewKind(selected) : 'placeholder';
  const siblingImages =
    selected && kind === 'image'
      ? materials.filter(
          (item) =>
            item.nodeId === selected.nodeId &&
            previewKind(item) === 'image' &&
            Boolean(item.previewUrl),
        )
      : [];

  return (
    <aside className="designer-materials" data-testid="designer-materials">
      <header className="designer-materials__header">
        <h2>{t('designer.materials.title')}</h2>
        <p>{t('designer.materials.hint')}</p>
        <div className="designer-materials__header-actions">
          {pendingNodeId && onCompare ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => onCompare(pendingNodeId)}
              data-testid="designer-materials-compare"
            >
              {t('designer.revision.compare')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={!selected || kind === 'placeholder'}
            onClick={() => selected && onOpenViewer(selected.id)}
            data-testid="designer-materials-open-viewer"
          >
            {t('designer.materials.viewLarge')}
          </button>
        </div>
      </header>
      <ul className="designer-materials__list">
        {materials.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                item.id === selected?.id
                  ? 'designer-materials__item is-selected'
                  : 'designer-materials__item'
              }
              onClick={() => onSelect(item.id)}
              data-testid={`designer-material-${item.id}`}
            >
              <span className="designer-materials__item-kind">{item.kind}</span>
              <strong>{item.label}</strong>
              <span className="designer-materials__item-state">
                {item.nodeId === pendingNodeId
                  ? t('designer.revision.pending')
                  : isEditableDesignerMaterial(item)
                    ? t('designer.materials.editable')
                    : item.previewUrl || item.textUrl
                      ? t('designer.materials.ready')
                      : t('designer.materials.placeholder')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div
        className={
          kind === 'text'
            ? 'designer-materials__preview designer-materials__preview--text'
            : 'designer-materials__preview'
        }
        data-testid="designer-material-preview"
      >
        {!selected ? (
          <p>{t('designer.materials.empty')}</p>
        ) : kind === 'video' && selected.previewUrl ? (
          <video
            key={selected.uri}
            className="designer-materials__media"
            src={selected.previewUrl}
            controls
            playsInline
          />
        ) : siblingImages.length > 1 ? (
          <div className="designer-materials__gallery" data-testid="designer-material-gallery">
            {siblingImages.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === selected?.id
                    ? 'designer-materials__gallery-item is-selected'
                    : 'designer-materials__gallery-item'
                }
                onClick={() => onOpenViewer(item.id)}
              >
                <img src={item.previewUrl ?? ''} alt={item.label} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : kind === 'image' && selected.previewUrl ? (
          <button
            type="button"
            className="designer-materials__media-hit"
            onClick={() => onOpenViewer(selected.id)}
          >
            <img
              className="designer-materials__media"
              src={selected.previewUrl}
              alt={selected.label}
            />
          </button>
        ) : kind === 'audio' && selected.previewUrl ? (
          <audio key={selected.uri} src={selected.previewUrl} controls />
        ) : kind === 'text' && selected.textUrl ? (
          <DesignerTextEditor material={selected} compact />
        ) : kind === 'file' && selected.previewUrl ? (
          <a href={selected.previewUrl} target="_blank" rel="noreferrer">
            {t('designer.materials.openFile')}
          </a>
        ) : (
          <p>{t('designer.materials.placeholderHint')}</p>
        )}
      </div>
    </aside>
  );
}
