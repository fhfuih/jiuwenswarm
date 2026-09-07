import type {
  DesignerExecutionGraph,
  DesignerGraphEdge,
  DesignerGraphNode,
  DesignerNodeConfig,
  NodeLayout,
} from './executionGraphTypes';

/** Minimal React Flow node shape used by the adapter (no @xyflow/react dependency). */
export type DesignerReactFlowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: string;
    config: DesignerNodeConfig;
    layout: NodeLayout;
    outputRef: DesignerGraphNode['output_ref'];
    outputRefs?: DesignerGraphNode['output_ref'][];
    status?: string;
    error?: string | null;
    pendingRevision?: boolean;
  };
  style?: {
    width?: number;
    height?: number;
  };
};

/** Minimal React Flow edge shape used by the adapter. */
export type DesignerReactFlowEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  kind?: string;
};

export type DesignerReactFlowGraph = {
  nodes: DesignerReactFlowNode[];
  edges: DesignerReactFlowEdge[];
};

export const DESIGNER_NODE_WIDTH = 280;
export const DESIGNER_NODE_HEIGHT = 160;

function layoutPosition(layout: NodeLayout | undefined): { x: number; y: number } {
  return {
    x: typeof layout?.x === 'number' ? layout.x : 0,
    y: typeof layout?.y === 'number' ? layout.y : 0,
  };
}

function nodeStyle(): DesignerReactFlowNode['style'] {
  return { width: DESIGNER_NODE_WIDTH, height: DESIGNER_NODE_HEIGHT };
}

export function toReactFlowGraph(graph: DesignerExecutionGraph): DesignerReactFlowGraph {
  const nodes: DesignerReactFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: layoutPosition(node.layout),
    style: nodeStyle(),
    data: {
      label: node.label,
      nodeType: node.type,
      config: node.config ?? {},
      layout: node.layout ?? {},
      outputRef: node.output_ref ?? null,
    },
  }));

  const edges: DesignerReactFlowEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'designer',
    label: edge.label,
    kind: edge.kind,
  }));

  return { nodes, edges };
}

function mergeLayout(position: { x: number; y: number }): NodeLayout {
  return {
    x: position.x,
    y: position.y,
    width: DESIGNER_NODE_WIDTH,
    height: DESIGNER_NODE_HEIGHT,
  };
}

export function fromReactFlowGraph(
  reactFlow: DesignerReactFlowGraph,
  domainGraph: DesignerExecutionGraph,
): DesignerExecutionGraph {
  const domainNodesById = new Map(domainGraph.nodes.map((node) => [node.id, node]));
  const nodes: DesignerGraphNode[] = reactFlow.nodes.map((rfNode) => {
    const existing = domainNodesById.get(rfNode.id);
    const data = rfNode.data ?? {
      label: rfNode.id,
      nodeType: rfNode.type,
      config: {},
      layout: {},
      outputRef: null,
    };
    return {
      id: rfNode.id,
      type: (existing?.type ?? data.nodeType ?? rfNode.type) as DesignerGraphNode['type'],
      label: data.label ?? existing?.label ?? rfNode.id,
      config: data.config ?? existing?.config ?? {},
      layout: mergeLayout(rfNode.position),
      output_ref: data.outputRef ?? existing?.output_ref ?? null,
    };
  });

  const domainEdgesById = new Map(domainGraph.edges.map((edge) => [edge.id, edge]));
  const edges: DesignerGraphEdge[] = reactFlow.edges.map((rfEdge) => {
    const existing = domainEdgesById.get(rfEdge.id);
    return {
      id: rfEdge.id,
      source: rfEdge.source,
      target: rfEdge.target,
      kind: rfEdge.kind ?? existing?.kind,
      label: rfEdge.label ?? existing?.label,
    };
  });

  return {
    ...domainGraph,
    nodes,
    edges,
    updated_at: Date.now(),
  };
}
