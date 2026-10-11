import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeStaticFiles } from './staticAnalysis.ts';

test('extracts routes, commands, events, jobs, and package metadata', () => {
  const result = analyzeStaticFiles([
    {
      path: 'src/server.ts',
      content: [
        'import express from "express";',
        'const app = express();',
        'app.get("/health", handler);',
        'app.post("/chat", handler);',
        'program.command("run-agent");',
        'queue.on("job:completed");',
        'setInterval(cleanup, 60000);',
      ].join('\n'),
    },
    {
      path: 'package.json',
      content: JSON.stringify({
        scripts: { dev: 'vite', test: 'node --test' },
        dependencies: { express: '^4.0.0' },
        devDependencies: { vite: '^5.0.0' },
      }),
    },
  ]);

  assert.equal(result.routes.length, 2);
  assert.deepEqual(
    result.routes.map((route) => `${route.method} ${route.path}`),
    ['GET /health', 'POST /chat'],
  );
  assert.ok(result.commands.some((command) => command.name === 'run-agent'));
  assert.ok(result.commands.some((command) => command.name === 'dev'));
  assert.ok(result.eventHandlers.some((event) => event.event === 'job:completed'));
  assert.ok(result.jobs.some((job) => job.name === 'interval job'));
  assert.equal(result.dependencies.express, '^4.0.0');
  assert.equal(result.scripts.test, 'node --test');
});

test('extracts Next.js App Router route paths', () => {
  const result = analyzeStaticFiles([
    {
      path: 'src/app/dashboard/settings/route.ts',
      content: 'export async function GET() {}',
    },
  ]);

  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].path, '/dashboard/settings');
  assert.equal(result.routes[0].framework, 'Next.js App Router');
});

test('extracts Python framework routes', () => {
  const result = analyzeStaticFiles([
    {
      path: 'server/main.py',
      content: '@app.post("/api/chat")',
    },
  ]);

  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].method, 'POST');
  assert.equal(result.routes[0].path, '/api/chat');
  assert.equal(result.routes[0].framework, 'Python web framework');
});
