import type { Project } from '../types';
import type { ProviderId } from './providers';
import type { Language } from '../i18n';

export interface AnalyzeRequest {
  repoUrl: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
  language: Language;
}

export async function analyzeRepository(request: AnalyzeRequest): Promise<Project> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Analysis failed: ${response.status}`);
  }

  return response.json();
}
