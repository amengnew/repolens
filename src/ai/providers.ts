export type ProviderId = 'mock' | 'openai' | 'deepseek' | 'anthropic' | 'gemini' | 'custom';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  endpoint: string;
}

export const providers: ProviderConfig[] = [
  {
    id: 'mock',
    label: 'Mock (local sample)',
    defaultModel: 'sample',
    models: ['sample'],
    endpoint: '',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    endpoint: 'https://api.deepseek.com/chat/completions',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-1.5-pro',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    defaultModel: '',
    models: [],
    endpoint: '',
  },
];

export interface CallAIOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  prompt: string;
  endpoint?: string;
  jsonMode?: boolean;
  maxTokens?: number;
}

export interface FetchModelsOptions {
  provider: ProviderId;
  apiKey: string;
  endpoint?: string;
}

async function saveCallDiagnostic(details: Record<string, unknown>) {
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir('.data', { recursive: true });
    await writeFile(
      '.data/ai-request-debug.json',
      JSON.stringify({ savedAt: new Date().toISOString(), ...details }, null, 2),
      'utf8',
    );
  } catch {
    // Diagnostics are best-effort and never block model calls.
  }
}

function diagnosticFromOpenAIResponse(data: unknown, url: string, tokenLimit: number, useJsonMode: boolean) {
  const choice = (data as { choices?: Array<Record<string, unknown>> })?.choices?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  const contentText = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const reasoning = message?.reasoning_content;
  const reasoningText = typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning ?? '');
  return {
    url,
    tokenLimit,
    useJsonMode,
    finishReason: choice?.finish_reason,
    usage: (data as Record<string, unknown>)['usage'],
    contentLength: contentText.length,
    contentPreview: contentText.slice(0, 800),
    contentTail: contentText.slice(-400),
    reasoningLength: reasoningText.length,
    reasoningPreview: reasoningText.slice(0, 300),
  };
}

function modelIdsFromData(data: unknown, useName = false): string[] {
  const payload = data as { data?: unknown; models?: unknown };
  const items = Array.isArray(payload.data) ? payload.data
    : Array.isArray(payload.models) ? payload.models
      : [];
  const ids = items.map((item) => {
    if (typeof item === 'string') return item;
    const candidate = item as { id?: unknown; name?: unknown };
    const value = useName ? candidate.name : candidate.id;
    return typeof value === 'string' ? value : '';
  }).filter((value) => value.length > 0);
  return [...new Set(ids)].sort();
}

function geminiModelIds(data: unknown): string[] {
  const payload = data as { models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }> };
  const models = Array.isArray(payload.models) ? payload.models : [];
  return [...new Set(models.flatMap((model) => {
    const methods = model.supportedGenerationMethods;
    if (Array.isArray(methods) && methods.length > 0 && !methods.includes('generateContent')) {
      return [];
    }
    return typeof model.name === 'string' ? [model.name.replace(/^models\//, '')] : [];
  }))].sort();
}

function extractChatContent(data: unknown): string {
  const choices = (data as { choices?: Array<{ message?: Record<string, unknown>; text?: unknown }> })?.choices;
  const message = choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string' && content.trim().length > 0) return content;
  if (Array.isArray(content)) {
    const joined = content.map((part) => {
      if (typeof part === 'string') return part;
      const text = (part as { text?: unknown })?.text;
      return typeof text === 'string' ? text : '';
    }).join('');
    if (joined.trim().length > 0) return joined;
  }

  const choiceText = choices?.[0]?.text;
  return typeof choiceText === 'string' ? choiceText : '';
}

export function chatCompletionsToModelsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/chat/completions')) {
    pathname = pathname.slice(0, -'/chat/completions'.length);
  }
  url.pathname = `${pathname}/models`.replace(/\/{2,}/g, '/');
  url.search = '';
  return url.toString();
}

async function fetchOpenAICompatibleModels(url: string, apiKey: string): Promise<string[]> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Model fetch failed: ${response.status} ${errorBody.slice(0, 300)}`);
  }
  return modelIdsFromData(await response.json());
}

export async function fetchModels({ provider, apiKey, endpoint }: FetchModelsOptions): Promise<string[]> {
  if (provider === 'mock') {
    return providers.find((item) => item.id === 'mock')?.models.slice() ?? ['sample'];
  }

  if (provider === 'openai') {
    return fetchOpenAICompatibleModels('https://api.openai.com/v1/models', apiKey);
  }

  if (provider === 'deepseek') {
    return fetchOpenAICompatibleModels('https://api.deepseek.com/models', apiKey);
  }

  if (provider === 'custom') {
    if (!endpoint) {
      throw new Error('Custom provider endpoint is required');
    }
    return fetchOpenAICompatibleModels(chatCompletionsToModelsUrl(endpoint), apiKey);
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Model fetch failed: ${response.status} ${errorBody.slice(0, 300)}`);
    }
    return modelIdsFromData(await response.json());
  }

  if (provider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    );
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Model fetch failed: ${response.status} ${errorBody.slice(0, 300)}`);
    }
    return geminiModelIds(await response.json());
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function callAI({
  provider,
  apiKey,
  model,
  prompt,
  endpoint,
  jsonMode = false,
  maxTokens = 8192,
}: CallAIOptions): Promise<string> {
  if (provider === 'mock') {
    return JSON.stringify({ note: 'Mock provider returns the local sample project.' });
  }

  if (provider === 'openai' || provider === 'deepseek' || provider === 'custom') {
    if (provider === 'custom' && !endpoint) {
      throw new Error('Custom provider endpoint is required');
    }

    const requestUrl: string = provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : provider === 'deepseek'
        ? 'https://api.deepseek.com/chat/completions'
        : endpoint ?? '';

    const promptMessages = [
      {
        role: 'system',
        content: 'You are a strict JSON data extraction engine. Produce the answer directly without chain-of-thought planning. Your entire response must be exactly one valid JSON object. Never include prose, Markdown fences, type templates, or explanations.',
      },
      { role: 'user', content: prompt },
    ];
    const baseBody = {
      model,
      messages: promptMessages,
      temperature: 0.2,
    };
    const tokenLimits = [...new Set([maxTokens, 16_384, 8_192].filter((limit) => limit <= maxTokens))];
    const requestTimeoutMs = 300_000;

    let lastErrorBody = 'AI request failed';
    for (const tokenLimit of tokenLimits) {
      const modes = jsonMode ? [true, false] : [false];
      for (const useJsonMode of modes) {
        const attempt = { tokenLimit, useJsonMode };
        const startedAt = Date.now();
        let response: Response;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
          response = await fetch(requestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              ...baseBody,
              max_tokens: attempt.tokenLimit,
              ...(attempt.useJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
            }),
            signal: controller.signal,
          });
        } catch (error) {
          const aborted = error instanceof Error && error.name === 'AbortError';
          const message = aborted
            ? `AI request timed out after ${requestTimeoutMs}ms`
            : error instanceof Error ? error.message : String(error);
          await saveCallDiagnostic({
            provider,
            model,
            event: aborted ? 'fetch-timeout' : 'fetch-failed',
            tokenLimit: attempt.tokenLimit,
            useJsonMode: attempt.useJsonMode,
            error: message,
            durationMs: Date.now() - startedAt,
          });
          throw new Error(`AI request failed: ${message}`);
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const errorBody = await response.text();
          lastErrorBody = errorBody.slice(0, 300);
          const jsonModeError = /response_format|json_object|json mode|unsupported param/i.test(lastErrorBody);
          await saveCallDiagnostic({
            provider,
            model,
            event: 'http-error',
            tokenLimit: attempt.tokenLimit,
            useJsonMode: attempt.useJsonMode,
            status: response.status,
            error: lastErrorBody,
            durationMs: Date.now() - startedAt,
          });
          if (jsonMode && useJsonMode && jsonModeError) continue;
          break;
        }

        const data = await response.json();
        const content = extractChatContent(data);
        await saveCallDiagnostic({
          provider,
          model,
          event: 'success',
          durationMs: Date.now() - startedAt,
          ...diagnosticFromOpenAIResponse(data, requestUrl, attempt.tokenLimit, attempt.useJsonMode),
        });
        if (content.trim().length === 0) {
          throw new Error('AI request returned an empty response');
        }
        return content;
      }
    }

    throw new Error(`AI request failed: ${lastErrorBody}`);
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI request failed: ${response.status} ${errorBody.slice(0, 300)}`);
    }
    const data = await response.json();
    return data.content?.[0]?.text ?? '';
  }

  if (provider === 'gemini') {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI request failed: ${response.status} ${errorBody.slice(0, 300)}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
