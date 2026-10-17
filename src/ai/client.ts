import type { Project } from '../types';
import type { ProviderId } from './providers';
import type { Language } from '../i18n';
import type { AnalysisProgress } from './analyze';

export interface AnalyzeRequest {
  repoUrl: string;
  provider: ProviderId;
  model: string;
  language: Language;
}

export type AnalysisJobStatus = 'queued' | 'running' | 'complete' | 'error';

export interface AnalysisJob {
  jobId: string;
  status: AnalysisJobStatus;
  progress: number;
  stage: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: Project;
  error?: string;
}

export async function startAnalysis(request: AnalyzeRequest): Promise<AnalysisJob> {
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

export async function getAnalysisJob(jobId: string): Promise<AnalysisJob> {
  const response = await fetch(`/api/analysis/${encodeURIComponent(jobId)}`);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Analysis status failed: ${response.status}`);
  }

  return response.json();
}

export interface AnalysisHistoryItem {
  jobId: string;
  name: string;
  repository: string;
  commit: string;
  provider: ProviderId;
  model: string;
  language: Language;
  completedAt: number;
  summary: string;
}

export async function getAnalysisHistory(): Promise<AnalysisHistoryItem[]> {
  const response = await fetch('/api/history');

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Analysis history failed: ${response.status}`);
  }

  return response.json();
}

export interface RepositoryHistoryItem {
  repository: string;
  name: string;
  analysisCount: number;
  latestJobId: string;
  latestCommit: string;
  latestCompletedAt: number;
  providers: string[];
  models: string[];
  summary: string;
}

export async function getRepositoryHistory(): Promise<RepositoryHistoryItem[]> {
  const response = await fetch('/api/repositories');

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Repository history failed: ${response.status}`);
  }

  return response.json();
}

export interface ProviderRuntimeConfig {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  endpoint: string;
  envKey: string | null;
  configured: boolean;
}

export async function getProviderConfigs(): Promise<ProviderRuntimeConfig[]> {
  const response = await fetch('/api/providers');

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Provider configuration failed: ${response.status}`);
  }

  return response.json();
}

export async function configureProvider(request: {
  provider: ProviderId;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  persist?: boolean;
}): Promise<{ configured: boolean; persisted: boolean; envKey: string; endpoint?: string }> {
  const response = await fetch('/api/provider/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Provider configuration failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchProviderModels(request: {
  provider: ProviderId;
  apiKey?: string;
  endpoint?: string;
}): Promise<{
  provider: ProviderId;
  models: string[];
  latencyMs: number;
}> {
  const response = await fetch('/api/providers/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: request.provider,
      apiKey: request.apiKey,
      endpoint: request.endpoint,
    }),
  });

  const text = await response.text();
  let result: { models?: unknown; latencyMs?: number; error?: string } = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = {};
  }

  if (!response.ok) {
    throw new Error(result.error || `Model fetch failed: ${response.status}`);
  }
  if (!Array.isArray(result.models)) {
    throw new Error('Model list response is invalid');
  }

  return {
    provider: request.provider,
    models: result.models.filter((item): item is string => typeof item === 'string'),
    latencyMs: result.latencyMs ?? 0,
  };
}

export async function testProvider(request: {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  endpoint?: string;
}): Promise<{
  ok: boolean;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  responsePreview: string;
  error?: string;
}> {
  let result: { ok?: boolean; error?: string; latencyMs?: number; responsePreview?: string };
  try {
    const response = await fetch('/api/provider/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const text = await response.text();
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }
    if (!response.ok) {
      throw new Error(result.error || `Provider test failed: ${response.status}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Provider test returned a non-JSON response');
    }
    throw error;
  }

  return {
    ok: true,
    provider: request.provider,
    model: request.model,
    latencyMs: result.latencyMs ?? 0,
    responsePreview: result.responsePreview ?? '',
  };
}

export function analyzeRepository(
  request: AnalyzeRequest,
  onProgress?: (progress: AnalysisProgress) => void,
): Promise<Project> {
  return startAnalysis(request).then(async (job) => {
    let currentJob = job;

    while (currentJob.status === 'queued' || currentJob.status === 'running') {
      onProgress?.({
        progress: currentJob.progress,
        stage: currentJob.stage,
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      currentJob = await getAnalysisJob(currentJob.jobId);
    }

    if (currentJob.status === 'error') {
      throw new Error(currentJob.error ?? 'Analysis failed');
    }

    if (!currentJob.result) {
      throw new Error('Analysis completed without a result');
    }

    onProgress?.({
      progress: 100,
      stage: currentJob.stage,
    });

    return currentJob.result;
  });
}
