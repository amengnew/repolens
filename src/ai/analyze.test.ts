import assert from 'node:assert/strict';
import test from 'node:test';
import { toProject } from './analyze.ts';

const context = {
  owner: 'example',
  name: 'agent-app',
  description: 'Example agent application',
  defaultBranch: 'main',
  commit: 'abc123',
  paths: ['src/index.ts'],
  staticAnalysis: {
    routes: [],
    commands: [],
    eventHandlers: [],
    jobs: [],
    dependencies: {},
    scripts: {},
  },
  selectedFiles: [
    {
      path: 'src/index.ts',
      content: [
        'import express from "express";',
        '',
        'const app = express();',
        'app.post("/chat", async (req, res) => {',
        '  const result = await runtime.execute(req.body);',
        '  res.json(result);',
        '});',
      ].join('\n'),
    },
  ],
};

test('creates source-verified evidence from an exact quote', () => {
  const project = toProject(
    {
      name: 'agent-app',
      summary: 'Example',
      flows: [
        {
          id: 'chat-flow',
          name: 'Chat flow',
          steps: ['Receive request'],
          sourcePath: 'src/index.ts',
          sourceQuote: 'app.post("/chat", async (req, res) => {',
        },
      ],
    },
    context,
    'en',
  );

  const evidence = project.evidence.find((item) => item.id === 'ev-chat-flow-node-0');
  assert.equal(evidence?.confidence, 'source verified');
  assert.equal(evidence?.startLine, 4);
  assert.equal(evidence?.file, 'src/index.ts');
});

test('downgrades missing files to inferred evidence', () => {
  const project = toProject(
    {
      name: 'agent-app',
      summary: 'Example',
      entries: [
        {
          id: 'cli-entry',
          name: 'CLI entry',
          sourcePath: 'missing/cli.ts',
          sourceQuote: 'program.command("run")',
        },
      ],
    },
    context,
    'en',
  );

  const evidence = project.evidence.find((item) => item.id === 'ev-entry-cli-entry');
  assert.equal(evidence?.confidence, 'inferred');
  assert.equal(evidence?.file, 'missing/cli.ts');
});

test('uses repository file evidence when a quote is unavailable', () => {
  const project = toProject(
    {
      name: 'agent-app',
      summary: 'Example',
      decisions: [
        {
          id: 'http-server',
          title: 'HTTP server boundary',
          solution: 'Uses Express at the route boundary.',
          sourcePath: 'src/index.ts',
        },
      ],
    },
    context,
    'zh',
  );

  const evidence = project.evidence.find((item) => item.id === 'ev-decision-http-server');
  assert.equal(evidence?.confidence, 'doc verified');
  assert.ok(evidence?.code.includes('import express'));
  assert.equal(project.repository, 'github.com/example/agent-app');
});
