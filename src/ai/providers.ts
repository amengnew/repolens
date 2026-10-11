export type ProviderId = 'mock' | 'openai' | 'deepseek' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  defaultModel: string;
  endpoint: string;
}

export const providers: ProviderConfig[] = [
  { id: 'mock', label: 'Mock (local sample)', defaultModel: 'sample', endpoint: '' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1/chat/completions' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat', endpoint: 'https://api.deepseek.com/chat/completions' },
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest', endpoint: 'https://api.anthropic.com/v1/messages' },
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-1.5-pro', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models' },
];

export interface CallAIOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  prompt: string;
}

export async function callAI({ provider, apiKey, model, prompt }: CallAIOptions): Promise<string> {
  if (provider === 'mock') {
    return JSON.stringify({ note: 'Mock provider returns the local sample project.' });
  }

  if (provider === 'openai' || provider === 'deepseek') {
    const response = await fetch(provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions', {
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
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
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
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const data = await response.json();
    return data.content?.[0]?.text ?? '';
  }

  if (provider === 'gemini') {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
