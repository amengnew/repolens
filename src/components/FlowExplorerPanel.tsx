import { useMemo } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { GitBranch, ShieldAlert, Workflow } from 'lucide-react';
import type { Project } from '../types';
import { FlowNodeCard, type FlowCardData } from './FlowNodeCard';
import { useI18n } from '../i18n';

interface FlowExplorerPanelProps {
  project: Project;
  selectedFlowId: string;
  selectedNodeId: string | null;
  onSelectFlow: (flowId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const nodeTypes = { repolens: FlowNodeCard };

const edgeColors: Record<string, string> = {
  call: '#4f46e5',
  data: '#0f766e',
  event: '#b45309',
  error: '#be123c',
  auth: '#64748b',
};

export function FlowExplorerPanel({
  project,
  selectedFlowId,
  selectedNodeId,
  onSelectFlow,
  onSelectNode,
}: FlowExplorerPanelProps) {
  const { t } = useI18n();
  const selectedFlow =
    project.flows.find((flow) => flow.id === selectedFlowId) ?? project.flows[0];
  const selectedNode =
    selectedFlow.nodes.find((node) => node.id === selectedNodeId) ?? selectedFlow.nodes[0];

  const flowNodes = useMemo<Node<FlowCardData, 'repolens'>[]>(() => {
    return selectedFlow.nodes.map((node) => ({
      id: node.id,
      type: 'repolens',
      position: node.position,
      selected: node.id === selectedNodeId,
      data: {
        label: node.label,
        nodeType: node.type,
        evidenceCount: node.evidenceIds.length,
      },
    }));
  }, [selectedFlow.nodes, selectedNodeId]);

  const flowEdges = useMemo<Edge[]>(() => {
    return selectedFlow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: edge.kind === 'event',
      style: { stroke: edgeColors[edge.kind] ?? '#94a3b8' },
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
  }, [selectedFlow.edges]);

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('flowExplorer')}</h1>
          <p className="section-subtitle">{selectedFlow.description}</p>
        </div>
      </div>

      <section className="panel-section">
        <h2 className="panel-heading">
          <Workflow size={15} />
          {t('coreFlows')}
        </h2>
        <div className="flow-tabs">
          {project.flows.map((flow) => (
            <button
              type="button"
              className="flow-tab"
              key={flow.id}
              aria-pressed={selectedFlow.id === flow.id}
              onClick={() => onSelectFlow(flow.id)}
            >
              {flow.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="flow-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => onSelectNode(node.id)}
            fitView
            minZoom={0.25}
            maxZoom={1.4}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#cbd5e1" gap={18} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </section>

      <section className="panel-section two-column">
        <div className="list-panel">
          <h2 className="panel-heading">
            <GitBranch size={15} />
            {t('selectedNode')}
          </h2>
          <p className="detail-text">
            <strong>{selectedNode.label}</strong>
          </p>
          <p className="path-summary">{selectedNode.description}</p>
          <div className="tag-row">
            {selectedNode.decisionIds.map((decisionId) => {
              const decision = project.decisions.find((item) => item.id === decisionId);
              return decision ? <span className="tag" key={decision.id}>{decision.title}</span> : null;
            })}
          </div>
        </div>
        <div className="list-panel">
          <h2 className="panel-heading">
            <ShieldAlert size={15} />
            {t('errorPaths')}
          </h2>
          <ul className="error-list">
            {selectedFlow.errorPaths.map((errorPath) => (
              <li key={errorPath}>
                <ShieldAlert size={14} />
                <span>{errorPath}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
