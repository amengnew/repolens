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
