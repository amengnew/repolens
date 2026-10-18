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
}

export interface FetchModelsOptions {
  provider: ProviderId;
  apiKey: string;
  endpoint?: string;
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
  const candidates = [message?.content, message?.reasoning_content];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
    if (Array.isArray(candidate)) {
      const joined = candidate.map((part) => {
        if (typeof part === 'string') return part;
        const text = (part as { text?: unknown })?.text;
        return typeof text === 'string' ? text : '';
      }).join('');
      if (joined.trim().length > 0) return joined;
    }
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

    const body = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON data extraction engine. Your entire response must be exactly one valid JSON object. Never include prose, Markdown fences, type templates, or explanations.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      if (jsonMode && /response_format|json_object|json mode|unsupported param/i.test(errorBody)) {
        const fallbackResponse = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ ...body, response_format: undefined }),
        });
        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.text();
          throw new Error(`AI request failed: ${fallbackResponse.status} ${fallbackError.slice(0, 300)}`);
        }
        const fallbackData = await fallbackResponse.json();
        const fallbackContent = extractChatContent(fallbackData);
        if (fallbackContent.trim().length === 0) {
          throw new Error('AI request returned an empty response');
        }
        return fallbackContent;
      }
      throw new Error(`AI request failed: ${response.status} ${errorBody.slice(0, 300)}`);
    }
    const data = await response.json();
    const content = extractChatContent(data);
    if (content.trim().length === 0) {
      throw new Error('AI request returned an empty response');
    }
    return content;
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
