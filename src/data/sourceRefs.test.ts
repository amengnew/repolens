import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceSourceUrl } from './sourceRefs.ts';

const project = {
  repository: 'https://github.com/deepseek-ai/DeepSeek-Harness',
  commit: 'abc123def456',
};

test('builds a commit-pinned GitHub line link', () => {
  assert.equal(
    evidenceSourceUrl(project, { file: 'src/bin.ts', startLine: 12, endLine: 14 }),
    'https://github.com/deepseek-ai/DeepSeek-Harness/blob/abc123def456/src/bin.ts#L12-L14',
  );
});

test('builds a single-line link and falls back to main without a commit', () => {
  assert.equal(
    evidenceSourceUrl({ ...project, commit: '' }, { file: 'src/bin.ts', startLine: 7, endLine: 7 }),
    'https://github.com/deepseek-ai/DeepSeek-Harness/blob/main/src/bin.ts#L7',
  );
});

test('returns an empty link for non-GitHub repositories', () => {
  assert.equal(
    evidenceSourceUrl({ ...project, repository: 'https://gitlab.com/a/b' }, { file: 'a.ts', startLine: 1, endLine: 1 }),
    '',
  );
});
