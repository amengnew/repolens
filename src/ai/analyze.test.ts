import assert from 'node:assert/strict';
import test from 'node:test';
import { isSubstantiveAnalysis, parseAIResponse, toProject } from './analyze.ts';

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

test('accepts JSON wrapped in markdown fences', () => {
  const analysis = parseAIResponse(`\`\`\`json
${JSON.stringify({ name: 'agent-app', summary: 'Fenced example' })}
\`\`\`
`);

  assert.equal(analysis.name, 'agent-app');
  assert.equal(analysis.summary, 'Fenced example');
});

test('extracts the JSON object when the model appends commentary', () => {
  const analysis = parseAIResponse(`${JSON.stringify({ name: 'agent-app', summary: 'Trailing prose example' })}

The repository also contains a docs directory with additional examples.
`);

  assert.equal(analysis.name, 'agent-app');
  assert.equal(analysis.summary, 'Trailing prose example');
});

test('finds the real JSON object when prose contains a broken template', () => {
  const analysis = parseAIResponse(`The requested shape is {"id":string,"name":string,"kind":"http"}.

Here is the actual analysis:
${JSON.stringify({ name: 'agent-app', summary: 'Embedded prose example' })}
That is the complete result.`);

  assert.equal(analysis.name, 'agent-app');
  assert.equal(analysis.summary, 'Embedded prose example');
});

test('normalizes an AI response entry with an unknown kind', () => {
  const analysis = parseAIResponse(JSON.stringify({
    name: 'agent-app',
    summary: 'Example',
    entries: [{ name: 'Bad entry', role: 'End user', kind: 'grpc' }],
  }));

  assert.equal(analysis.entries?.[0].kind, 'tool');
  assert.equal(analysis.entries?.[0].role, 'End user');
});

test('normalizes an AI response flow with malformed steps', () => {
  const analysis = parseAIResponse(JSON.stringify({
    name: 'agent-app',
    summary: 'Example',
    flows: [{ name: 'Bad flow', steps: 'Receive request' }],
  }));

  assert.deepEqual(analysis.flows?.[0].steps, []);
});

test('unwraps a wrapper object around the real analysis', () => {
  const analysis = parseAIResponse(JSON.stringify({
    status: 'ok',
    data: {
      name: 'agent-app',
      summary: 'Example',
      entries: [{ name: 'CLI entry', role: 'Developer', kind: 'cli' }],
    },
  }));

  assert.equal(analysis.name, 'agent-app');
  assert.equal(analysis.entries?.length, 1);
});

test('drops entries that have no usable name', () => {
  const analysis = parseAIResponse(JSON.stringify({
    name: 'agent-app',
    summary: 'Example',
    entries: [{ role: 'End user', kind: 'http' }, { name: 'Kept entry', role: 'Developer', kind: 'cli' }],
  }));

  assert.equal(analysis.entries?.length, 1);
  assert.equal(analysis.entries?.[0].name, 'Kept entry');
});

test('hydrates empty structured sections from static analysis', () => {
  const project = toProject(
    { name: 'agent-app', summary: 'Example' },
    {
      ...context,
      staticAnalysis: {
        ...context.staticAnalysis,
        routes: [{ method: 'GET', path: '/health', file: 'src/index.ts', line: 3, framework: 'Express' }],
      },
    },
    'en',
  );

  assert.equal(project.entries[0].kind, 'http');
  assert.equal(project.entries[0].name, 'GET /health');
  assert.equal(project.flows[0].name, 'GET /health');
  assert.equal(project.flows[0].nodes.length, 4);
});

test('treats metadata-only AI output as not substantive', () => {
  assert.equal(isSubstantiveAnalysis({ name: 'agent-app', summary: 'Example' }), false);
  assert.equal(
    isSubstantiveAnalysis({ name: 'agent-app', summary: 'Example', flows: [{ name: 'Flow', steps: ['Step'] }] }),
    true,
  );
});
