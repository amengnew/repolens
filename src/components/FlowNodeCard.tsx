import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type FlowCardData = {
  label: string;
  nodeType: string;
  evidenceCount: number;
};

export type FlowCardNode = Node<FlowCardData, 'repolens'>;

export function FlowNodeCard({ data, selected }: NodeProps<FlowCardNode>) {
  return (
    <div className={`flow-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-type">{data.nodeType}</span>
      <span className="flow-node-label">{data.label}</span>
      <span className="flow-node-count">{data.evidenceCount} evidence</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
