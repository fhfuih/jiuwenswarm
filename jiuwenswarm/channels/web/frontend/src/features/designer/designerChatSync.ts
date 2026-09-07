import {
  DESIGNER_NODE_ROLE_BRIEF,
  type DesignerExecutionGraph,
} from './executionGraphTypes';

export function extractDesignerSourcePrompt(graph: DesignerExecutionGraph | null | undefined): string {
  if (!graph) return '';
  const brief = graph.nodes.find((node) => {
    const role = node.config && typeof node.config === 'object' ? node.config.role : undefined;
    return role === DESIGNER_NODE_ROLE_BRIEF || node.id === 'n_brief';
  });
  const fromBrief =
    brief?.config && typeof brief.config.prompt === 'string' ? brief.config.prompt.trim() : '';
  if (fromBrief) return fromBrief;
  return typeof graph.description === 'string' ? graph.description.trim() : '';
}
