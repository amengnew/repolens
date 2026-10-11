import assert from 'node:assert/strict';
import test from 'node:test';
import { compareProjects } from './comparison.ts';
import type { Project } from '../types.ts';

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: 'agent-app',
    repository: 'github.com/example/agent-app',
    commit: 'commit-a',
    summary: 'Example',
    techStack: ['TypeScript'],
    complexity: [],
    coreModules: [],
    importantFiles: [],
    entries: [],
    flows: [],
    decisions: [],
    learningPath: [],
    evidence: [],
    askSamples: [],
    ...overrides,
  };
}

test('detects added, removed, and unchanged sections', () => {
  const base = project({
    entries: [
      {
        id: 'old',
        name: 'Old entry',
        role: 'End user',
        kind: 'http',
        input: 'Old input',
        auth: 'Session',
        permissions: [],
        flowId: '',
        evidenceIds: [],
      },
    ],
  });
  const target = project({
    commit: 'commit-b',
    entries: [
      {
        id: 'new',
        name: 'New entry',
        role: 'Admin',
        kind: 'cli',
        input: 'New input',
        auth: 'Token',
        permissions: [],
        flowId: '',
        evidenceIds: [],
      },
    ],
  });

  const result = compareProjects(base, target, {
    base: { jobId: 'base', provider: 'mock', model: 'sample', language: 'zh', completedAt: 1 },
    target: { jobId: 'target', provider: 'mock', model: 'sample', language: 'zh', completedAt: 2 },
  });

  assert.equal(result.counts.entries.added, 1);
  assert.equal(result.counts.entries.removed, 1);
  assert.equal(result.changes.find((change) => change.name === 'New entry')?.status, 'added');
  assert.equal(result.changes.find((change) => change.name === 'Old entry')?.status, 'removed');
});

test('detects changed decisions', () => {
  const base = project({
    decisions: [
      {
        id: 'decision-1',
        title: 'Context strategy',
        topic: 'Context',
        problem: 'Too long',
        solution: 'Summarize',
        parameters: [{ key: 'Budget', value: '12000' }],
        rationale: 'Cost',
        alternatives: [],
        tradeoffs: [],
        evidenceIds: [],
      },
    ],
  });
  const target = project({
    decisions: [
      {
        id: 'decision-1',
        title: 'Context strategy',
        topic: 'Context',
        problem: 'Too long',
        solution: 'Retrieve',
        parameters: [{ key: 'Budget', value: '16000' }],
        rationale: 'Cost',
        alternatives: [],
        tradeoffs: [],
        evidenceIds: [],
      },
    ],
  });

  const result = compareProjects(base, target, {
    base: { jobId: 'base', provider: 'mock', model: 'sample', language: 'zh', completedAt: 1 },
    target: { jobId: 'target', provider: 'mock', model: 'sample', language: 'zh', completedAt: 2 },
  });

  assert.equal(result.counts.decisions.changed, 1);
});
