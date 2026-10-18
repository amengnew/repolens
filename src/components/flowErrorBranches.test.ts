import test from 'node:test';
import assert from 'node:assert/strict';
import type { Flow } from '../types.ts';
import { buildFlowErrorBranches } from './flowErrorBranches.ts';

const flow: Flow = {
  id: 'demo',
  name: 'Demo',
  trigger: 'request',
  description: '',
  nodes: [
    { id: 'a', label: 'A', type: 'api', description: '', evidenceIds: [], decisionIds: [], position: { x: 0, y: 0 } },
    { id: 'b', label: 'B', type: 'service', description: '', evidenceIds: [], decisionIds: [], position: { x: 220, y: 0 } },
  ],
  edges: [],
  errorPaths: ['missing key -> 400', 'timeout -> fallback'],
};

test('builds one error branch per error path from the final node', () => {
  const result = buildFlowErrorBranches(flow);

  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 2);
  assert.equal(result.edges[0].source, 'b');
  assert.equal(result.nodes[0].label, 'missing key -> 400');
  assert.ok(result.nodes[0].position.x > flow.nodes[1].position.x);
  assert.ok(result.nodes[1].position.y > result.nodes[0].position.y);
});

test('returns empty branches when the flow has no nodes or error paths', () => {
  assert.deepEqual(buildFlowErrorBranches({ ...flow, errorPaths: [] }), { nodes: [], edges: [] });

  assert.deepEqual(
    buildFlowErrorBranches({ ...flow, nodes: [], errorPaths: ['unexpected'] }),
    { nodes: [], edges: [] },
  );
});
