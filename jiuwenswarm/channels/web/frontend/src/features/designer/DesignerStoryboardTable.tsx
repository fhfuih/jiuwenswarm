import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseMarkdownTable,
  sanitizeMarkdownTableCell,
  serializeMarkdownTable,
  type MarkdownTablePreview,
} from './designerNodePreview';

type DesignerStoryboardTableProps = {
  text: string;
  testId: string;
  layout: 'node' | 'full';
};

export function DesignerStoryboardTable({ text, testId, layout }: DesignerStoryboardTableProps) {
  const table = parseMarkdownTable(text);
  if (!table) {
    return (
      <pre
        className={`designer-storyboard-table__raw designer-storyboard-table__raw--${layout}`}
        data-testid={testId}
        data-variant="raw"
      >
        {text}
      </pre>
    );
  }
  return (
    <table
      className={`designer-storyboard-table designer-storyboard-table--${layout}`}
      data-testid={testId}
      data-variant="table"
    >
      <thead>
        <tr>
          {table.headers.map((header, index) => (
            <th key={index} scope="col" data-testid={`${testId}-header`} data-variant={header}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex} data-testid={`${testId}-row`} data-variant={row[0] || String(rowIndex + 1)}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type DesignerStoryboardTableDraftProps = {
  text: string;
  disabled?: boolean;
  onChange: (text: string) => void;
};

/** Edits cells and adds/removes rows; the header row and column order are fixed. */
export function DesignerStoryboardTableDraft({ text, disabled = false, onChange }: DesignerStoryboardTableDraftProps) {
  const { t } = useTranslation();
  const [table, setTable] = useState<MarkdownTablePreview | null>(() => parseMarkdownTable(text));
  const emitted = useRef(text);

  useEffect(() => {
    if (text === emitted.current) return;
    emitted.current = text;
    setTable(parseMarkdownTable(text));
  }, [text]);

  if (!table) return null;

  const commit = (rows: string[][]) => {
    const next = { headers: table.headers, rows };
    const serialized = serializeMarkdownTable(next);
    emitted.current = serialized;
    setTable(next);
    onChange(serialized);
  };

  const setCell = (rowIndex: number, cellIndex: number, value: string) => {
    commit(
      table.rows.map((row, index) =>
        index === rowIndex ? row.map((cell, column) => (column === cellIndex ? value : cell)) : row,
      ),
    );
  };

  const addRow = () => {
    const shotNumbers = table.rows.map((row) => Number.parseInt(row[0] || '', 10)).filter(Number.isFinite);
    const nextShot = String((shotNumbers.length ? Math.max(...shotNumbers) : table.rows.length) + 1);
    commit([...table.rows, table.headers.map((_, index) => (index === 0 ? nextShot : ''))]);
  };

  return (
    <div className="designer-storyboard-table-draft" data-testid="designer-storyboard-table-draft">
      <table className="designer-storyboard-table designer-storyboard-table--full designer-storyboard-table--editing">
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={index} scope="col" data-testid="designer-storyboard-table-draft-header" data-variant={header}>
                {header}
              </th>
            ))}
            <th scope="col" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} data-testid="designer-storyboard-table-draft-row" data-variant={String(rowIndex + 1)}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  <textarea
                    className="designer-storyboard-table__cell-input"
                    value={cell}
                    rows={2}
                    disabled={disabled}
                    aria-label={`${table.headers[cellIndex] || ''} ${rowIndex + 1}`}
                    data-testid="designer-storyboard-table-draft-cell"
                    data-variant={`${rowIndex + 1}:${cellIndex + 1}`}
                    onChange={(event) => setCell(rowIndex, cellIndex, sanitizeMarkdownTableCell(event.target.value))}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="btn designer-storyboard-table__row-delete"
                  disabled={disabled || table.rows.length <= 1}
                  aria-label={t('designer.materials.deleteTableRow', { row: rowIndex + 1 })}
                  title={t('designer.materials.deleteTableRow', { row: rowIndex + 1 })}
                  data-testid="designer-storyboard-table-draft-delete-row"
                  data-variant={String(rowIndex + 1)}
                  onClick={() => commit(table.rows.filter((_, index) => index !== rowIndex))}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn designer-storyboard-table__row-add"
        disabled={disabled}
        data-testid="designer-storyboard-table-draft-add-row"
        onClick={addRow}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden />
        {t('designer.materials.addTableRow')}
      </button>
    </div>
  );
}

export function DesignerStoryboardTableFromUrl({
  url,
  testId,
  layout,
}: {
  url: string;
  testId: string;
  layout: 'node' | 'full';
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ text: string; failed: boolean; loading: boolean }>({
    text: '',
    failed: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ text: '', failed: false, loading: true });
    void fetch(url, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((value) => {
        if (!cancelled) setState({ text: value, failed: false, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ text: '', failed: true, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.failed) {
    return <p data-testid={`${testId}-error`}>{t('designer.materials.textError')}</p>;
  }
  if (state.loading) return null;
  return <DesignerStoryboardTable text={state.text} testId={testId} layout={layout} />;
}
