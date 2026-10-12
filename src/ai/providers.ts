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
}

export async function callAI({ provider, apiKey, model, prompt, endpoint }: CallAIOptions): Promise<string> {
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

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI request failed: ${response.status} ${errorBody.slice(0, 300)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
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
        max_tokens: 4096,
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
