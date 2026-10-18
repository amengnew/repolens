import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleProject } from '../data/sampleProject.ts';
import {
  buildAskPrompt,
  buildMockAskResult,
  parseAskResponse,
} from './ask.ts';

test('builds an ask prompt with the evidence inventory', () => {
  const prompt = buildAskPrompt(sampleProject, 'How does chat streaming work?', 'zh');
  assert.match(prompt, /How does chat streaming work\?/);
  assert.match(prompt, /Evidence \(id, file, lines, confidence, code excerpt\)/);
  assert.match(prompt, /exact evidence id/);
  assert.match(prompt, /Simplified Chinese/);
});

test('parses a fenced ask response and keeps known evidence ids', () => {
  const text = `\`\`\`json
{
  "answer": "前端先乐观追加消息，再通过 SSE 接收增量。",
  "citations": [
    { "evidenceId": "ev-chat-ui", "quote": "optimistic chat submission" },
    { "evidenceId": "ev-missing", "quote": "not in the project" }
  ]
}
\`\`\``;
  const result = parseAskResponse(text, sampleProject);
  assert.ok(result);
  assert.equal(result.answer, '前端先乐观追加消息，再通过 SSE 接收增量。');
  assert.deepEqual(result.evidenceIds, ['ev-chat-ui']);
});

test('resolves file-and-line citations to evidence ids', () => {
  const text = JSON.stringify({
    answer: '入口在 chat.tsx 的提交函数。',
    citations: [
      { file: 'apps/web/src/routes/chat.tsx', line: 120, quote: 'appendMessage' },
      { evidenceId: 'ev-chat-route' },
    ],
  });
  const result = parseAskResponse(text, sampleProject);
  assert.ok(result);
  assert.deepEqual(result.evidenceIds, ['ev-chat-ui', 'ev-chat-route']);
});

test('rejects an ask response without an answer', () => {
  assert.equal(parseAskResponse('{"citations": []}', sampleProject), null);
  assert.equal(parseAskResponse('just prose', sampleProject), null);
});

test('mock answer falls back to the first sample', () => {
  const result = buildMockAskResult(sampleProject, 'anything');
  assert.equal(result.answer, sampleProject.askSamples[0].answer);
  assert.deepEqual(result.evidenceIds, sampleProject.askSamples[0].evidenceIds);
});
