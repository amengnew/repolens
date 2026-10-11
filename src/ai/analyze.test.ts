import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAIResponse, toProject } from './analyze.ts';

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

test('accepts a valid structured AI response', () => {
  const analysis = parseAIResponse(JSON.stringify({
    name: 'agent-app',
    summary: 'Example',
    entries: [
      {
        name: 'Send message',
        role: 'End user',
        kind: 'http',
        permissions: ['chat:create'],
      },
    ],
    flows: [
      { name: 'Chat flow', steps: ['Receive request', 'Call model'] },
    ],
    decisions: [
      {
        title: 'Context compression',
        problem: 'Context is too long',
        solution: 'Summarize older turns',
        parameters: [{ key: 'Budget', value: '12000' }],
      },
    ],
  }));

  assert.equal(analysis.name, 'agent-app');
  assert.equal(analysis.entries?.length, 1);
  assert.equal(analysis.flows?.length, 1);
  assert.equal(analysis.decisions?.length, 1);
});

test('rejects an invalid AI response entry kind', () => {
  assert.throws(
    () => parseAIResponse(JSON.stringify({
      name: 'agent-app',
      summary: 'Example',
      entries: [{ name: 'Bad entry', role: 'End user', kind: 'grpc' }],
    })),
    /entry kind is invalid/,
  );
});

test('rejects an AI response flow with malformed steps', () => {
  assert.throws(
    () => parseAIResponse(JSON.stringify({
      name: 'agent-app',
      summary: 'Example',
      flows: [{ name: 'Bad flow', steps: 'Receive request' }],
    })),
    /requires a string array named steps/,
  );
});
