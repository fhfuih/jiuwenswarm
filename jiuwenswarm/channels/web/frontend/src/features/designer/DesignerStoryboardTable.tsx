import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMarkdownTable } from './designerNodePreview';

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
