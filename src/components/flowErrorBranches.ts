import type { Flow } from '../types';

export interface ErrorBranchNode {
  id: string;
  position: { x: number; y: number };
  label: string;
}

export interface ErrorBranchEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowErrorBranches {
  nodes: ErrorBranchNode[];
  edges: ErrorBranchEdge[];
}

export function buildFlowErrorBranches(flow: Flow): FlowErrorBranches {
  if (flow.nodes.length === 0 || flow.errorPaths.length === 0) {
    return { nodes: [], edges: [] };
  }

  const lastNode = flow.nodes[flow.nodes.length - 1];
  const anchor = lastNode.position ?? { x: 0, y: 0 };
  const maxX = Math.max(...flow.nodes.map((node) => node.position.x));

  const nodes = flow.errorPaths.map((errorPath, index) => ({
    id: `error-branch-${index}`,
    position: { x: maxX + 220, y: anchor.y + 150 + index * 130 },
    label: errorPath,
  }));

  const edges = nodes.map((node, index) => ({
    id: `error-edge-${index}`,
    source: lastNode.id,
    target: node.id,
  }));

  return { nodes, edges };
}
