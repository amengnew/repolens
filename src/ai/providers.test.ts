import assert from 'node:assert/strict';
import test from 'node:test';
import { chatCompletionsToModelsUrl } from './providers.ts';

test('derives a models URL from a chat completions endpoint', () => {
  assert.equal(
    chatCompletionsToModelsUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/models',
  );
});

test('derives a models URL from an endpoint with a trailing slash', () => {
  assert.equal(
    chatCompletionsToModelsUrl('https://api.example.com/v1/chat/completions/'),
    'https://api.example.com/v1/models',
  );
});

test('appends /models when the endpoint is a base URL', () => {
  assert.equal(
    chatCompletionsToModelsUrl('https://api.example.com/v1'),
    'https://api.example.com/v1/models',
  );
});
