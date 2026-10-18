import assert from 'node:assert/strict';
import test from 'node:test';
import { isSubstantiveAnalysis, parseAIResponse, selectRepositoryPaths, toProject } from './analyze.ts';

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
  assert.equal(evidence?.confidence, 'source verified');
  assert.ok(evidence?.code.includes('app.post'));
  assert.equal(project.repository, 'github.com/example/agent-app');
});

test('synthesizes a non-empty rationale when AI omits it', () => {
  const project = toProject(
    {
      name: 'agent-app',
      summary: 'Example',
      decisions: [
        {
          id: 'context-budget',
          title: 'Context budget',
          problem: 'Older turns grow without limit',
          solution: 'Summarize turns older than the budget',
          parameters: [{ key: 'Budget', value: '12000' }],
        },
      ],
    },
    context,
    'zh',
  );

  assert.ok(project.decisions[0].rationale.length > 20);
  assert.match(project.decisions[0].rationale, /Budget=12000/);
});

test('selects real source files over documentation variants', () => {
  const paths = [
    'README.md',
    'README.i18n.yaml',
    'apps/cli/README.md',
    'apps/cli/README.zh.md',
    'apps/cli/README.i18n.yaml',
    'apps/cli/package.json',
    'apps/cli/src/bin.ts',
    'apps/cli/src/args.ts',
    'apps/cli/src/runner.ts',
    'apps/cli/src/commands/run.ts',
    'apps/desktop/package.json',
    'apps/desktop/src/main.ts',
    'apps/desktop/src/ui.ts',
    'packages/core/src/harness.ts',
    'packages/core/src/plugin.ts',
    'docs/architecture.md',
    'server/index.ts',
  ];

  const selected = selectRepositoryPaths(paths, 14);

  assert.ok(selected.includes('apps/cli/src/bin.ts'));
  assert.ok(selected.includes('apps/cli/src/args.ts'));
  assert.ok(!selected.includes('README.i18n.yaml'));
  assert.ok(!selected.includes('apps/cli/README.i18n.yaml'));
  assert.ok(selected.filter((path) => path.endsWith('.md')).length <= 2);
  assert.ok(selected.includes('README.md'));
});

test('keeps strong CLI entries when the same directory is full', () => {
  const selected = selectRepositoryPaths([
    'apps/api/README.md',
    'apps/api/package.json',
    'apps/api/src/routes/health.ts',
    'apps/api/src/bin.ts',
    'apps/api/src/args.ts',
    'apps/api/src/index.ts',
  ], 8);

  assert.ok(selected.includes('apps/api/src/bin.ts'));
  assert.ok(selected.includes('apps/api/src/args.ts'));
  assert.ok(selected.includes('apps/api/src/index.ts'));
});

test('drops docs-site and website scaffolding from source selection', () => {
  const selected = selectRepositoryPaths([
    'apps/cli/src/args.ts',
    'apps/cli/src/bin.ts',
    'apps/web/package.json',
    'apps/web/src/main.ts',
    'website/package.json',
    'website/.vitepress/theme/index.ts',
    'README.md',
    'package.json',
    'python/sdk/pyproject.toml',
    'python/sdk/src/deepseek_harness/api.py',
  ], 14);

  assert.ok(selected.includes('apps/cli/src/args.ts'));
  assert.ok(selected.includes('apps/cli/src/bin.ts'));
  assert.ok(selected.includes('python/sdk/src/deepseek_harness/api.py'));
  assert.ok(!selected.includes('website/package.json'));
  assert.ok(!selected.includes('website/.vitepress/theme/index.ts'));
});

test('matches source quotes across whitespace and line wrapping', () => {
  const evidence = toProject(
    {
      name: 'agent-app',
      summary: 'Example',
      flows: [
        {
          id: 'chat-flow',
          name: 'Chat flow',
          steps: ['Receive request'],
          sourcePath: 'src/index.ts',
          sourceQuote: 'app.post(\n  "/chat",\n  async (req, res) => {',
        },
      ],
    },
    context,
    'en',
  );

  const item = evidence.evidence.find((entry) => entry.id === 'ev-chat-flow-node-0');
  assert.equal(item?.confidence, 'source verified');
  assert.equal(item?.startLine, 4);
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

test('rejects stray small objects from prose', () => {
  assert.throws(
    () => parseAIResponse(`Thinking about the schema:
{"key":"flagOwnership","value":"launcher parses only its own flags"}
Need to continue and write the real JSON.`),
    /does not contain repository analysis fields/,
  );
});

test('rejects a partial nested entry object from a truncated response', () => {
  assert.throws(
    () => parseAIResponse(`{
  "name": "agent-app",
  "summary": "Example",
  "entries": [
    {
      "id": "cli-entry",
      "name": "CLI entry",
      "sourcePath": "apps/cli/src/bin.ts"
    }
  ]`),
    /partial nested JSON object/,
  );
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

test('marks hydrated output as static when AI returned no structured sections', () => {
  const project = toProject(
    { name: 'agent-app', summary: 'Example' },
    context,
    'en',
    'static',
  );

  assert.equal(project.analysisMode, 'static');
});

test('anchors static event evidence to its own listener line', () => {
  const file = [
    'import express from "express";',
    '',
    'const app = express();',
    'app.use(express.json());',
    'app.get("/health", handler);',
    'app.post("/chat", handler);',
    'app.use(errorHandler);',
    '',
    'const server = app.listen(3000);',
    '',
    'server.on("listening", () => console.log("up"));',
    'server.on("ready", () => console.log("ready"));',
  ].join('\n');
  const project = toProject(
    { name: 'agent-app', summary: 'Example' },
    {
      ...context,
      selectedFiles: [{ path: 'src/index.ts', content: file }],
      staticAnalysis: {
        ...context.staticAnalysis,
        eventHandlers: [
          { event: 'error', file: 'src/index.ts', line: 7 },
          { event: 'ready', file: 'src/index.ts', line: 12 },
        ],
      },
    },
    'en',
  );

  const errorEvidence = project.evidence.find(
    (item) => item.id === 'ev-static-flow-1' || item.id === 'ev-entry-static-entry-1',
  );
  assert.deepEqual(errorEvidence?.startLine, 7);
  assert.ok(errorEvidence?.code.includes('app.use(errorHandler'));
  const readyEvidence = project.evidence.find((item) => item.id === 'ev-static-flow-2');
  assert.deepEqual(readyEvidence?.startLine, 12);
});

test('treats metadata-only AI output as not substantive', () => {
  assert.equal(isSubstantiveAnalysis({ name: 'agent-app', summary: 'Example' }), false);
  assert.equal(
    isSubstantiveAnalysis({ name: 'agent-app', summary: 'Example', flows: [{ name: 'Flow', steps: ['Step'] }] }),
    true,
  );
});
