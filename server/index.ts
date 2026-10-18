import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeRepository, synthesizeDecisionRationale } from '../src/ai/analyze.ts';
import {
  buildAskPrompt,
  buildMockAskResult,
  parseAskResponse,
  type AskResult,
} from '../src/ai/ask.ts';
import {
  callAI,
  fetchModels,
  providers,
  type ProviderConfig,
  type ProviderId,
} from '../src/ai/providers.ts';

const port = 3001;
const dataDir = path.resolve(process.cwd(), '.data');
const projectsFile = path.join(dataDir, 'projects.json');
const jobsFile = path.join(dataDir, 'jobs.json');

async function loadDotEnv() {
  try {
    const raw = await readFile(path.resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env file is required; provider keys can also be set in the shell.
  }
}

await loadDotEnv();

type Language = 'en' | 'zh';

interface AnalysisRequest {
  repoUrl: string;
  provider: ProviderId;
  model: string;
  language: Language;
  force?: boolean;
}

type JobStatus = 'queued' | 'running' | 'complete' | 'error';

interface AnalysisJob {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  request: AnalysisRequest;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

const jobs = new Map<string, AnalysisJob>();
const jobQueue: string[] = [];
const maxConcurrentJobs = 2;
let activeJobCount = 0;

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  }));
}

function parseRequest(body: string): AnalysisRequest {
  const parsed = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Request body must be an object');
  }

  const { repoUrl, provider, model, language, force } = parsed as Partial<AnalysisRequest>;
  if (typeof repoUrl !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(repoUrl)) {
    throw new Error('repoUrl must be a GitHub repository URL');
  }
  if (!providers.some((item) => item.id === provider)) {
    throw new Error('provider is invalid');
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('model must be a non-empty string');
  }
  if (language !== 'en' && language !== 'zh') {
    throw new Error('language must be en or zh');
  }

  return { repoUrl, provider, model, language, force: force === true };
}

function normalizedRepositoryUrl(repoUrl: string) {
  return repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
}

function backfillDecisionRationale(project: unknown, language: Language = 'zh'): unknown {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
  const { decisions } = project as {
    decisions?: Array<{
      rationale?: string;
      problem?: string;
      solution?: string;
      parameters?: Array<{ key: string; value: string }>;
    }>;
  };
  if (!Array.isArray(decisions)) return project;
  for (const decision of decisions) {
    if (typeof decision.rationale === 'string' && decision.rationale.trim().length > 0) continue;
    decision.rationale = synthesizeDecisionRationale(decision, language);
  }
  return project;
}

function findLatestProject(repoUrl: string): unknown | null {
  const normalized = normalizedRepositoryUrl(repoUrl);
  const completed = Array.from(jobs.values())
    .filter((job) => job.status === 'complete')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  for (const job of completed) {
    const result = job.result as { repository?: string } | undefined;
    if (normalizedRepositoryUrl(result?.repository ?? '') === normalized
      || normalizedRepositoryUrl(job.request.repoUrl) === normalized) {
      return result ? backfillDecisionRationale(result, job.request.language) : null;
    }
  }
  return null;
}

function parseAskRequest(body: string): AnalysisRequest & { question: string } {
  const request = parseRequest(body);
  const parsed = JSON.parse(body) as { question?: unknown };
  if (typeof parsed.question !== 'string' || parsed.question.trim().length === 0) {
    throw new Error('question must be a non-empty string');
  }
  return { ...request, question: parsed.question.trim() };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AI request timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const providerEnvKeys: Record<ProviderId, string | null> = {
  mock: null,
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  custom: 'CUSTOM_AI_API_KEY',
};

// Bump this when analysis prompts or context selection change so stale cached
// results are not served for the same repository/model/commit combination.
const analysisCacheRevision = 'source-first-v5';

const providerModelEnvKeys: Record<ProviderId, string | null> = {
  mock: null,
  openai: 'OPENAI_MODEL',
  deepseek: 'DEEPSEEK_MODEL',
  anthropic: 'ANTHROPIC_MODEL',
  gemini: 'GEMINI_MODEL',
  custom: 'CUSTOM_AI_MODEL',
};

function providerModel(provider: ProviderId) {
  const envKey = providerModelEnvKeys[provider];
  return envKey ? process.env[envKey] ?? '' : '';
}

function providerModelOptions(provider: ProviderConfig) {
  const savedModel = providerModel(provider.id);
  if (savedModel && !provider.models.includes(savedModel)) {
    return [savedModel, ...provider.models];
  }
  return provider.models;
}

function providerApiKey(provider: ProviderId) {
  const envKey = providerEnvKeys[provider];
  return envKey ? process.env[envKey] ?? '' : '';
}

function customEndpoint() {
  return process.env.CUSTOM_AI_ENDPOINT ?? '';
}

function validEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function saveEnvValue(envKey: string, value: string) {
  const envPath = path.resolve(process.cwd(), '.env');
  const raw = await readFile(envPath, 'utf8').catch(() => '');
  const lines = raw.split(/\r?\n/);
  let found = false;

  const nextLines = lines.map((line) => {
    if (line.trim().startsWith(`${envKey}=`)) {
      found = true;
      return `${envKey}=${value}`;
    }
    return line;
  });

  if (!found) {
    nextLines.push(`${envKey}=${value}`);
  }

  await writeFile(envPath, nextLines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
}

function publicProviders() {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    defaultModel: providerModel(provider.id) || provider.defaultModel,
    models: providerModelOptions(provider),
    endpoint: provider.id === 'custom' ? customEndpoint() : provider.endpoint,
    envKey: providerEnvKeys[provider.id],
    configured: provider.id === 'mock' ||
      (provider.id === 'custom'
        ? customEndpoint().length > 0 && providerApiKey('custom').length > 0
        : providerApiKey(provider.id).length > 0),
  }));
}

function parseProviderRequest(body: string) {
  const parsed = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Request body must be an object');
  }

  const provider = parsed.provider as ProviderId | undefined;
  if (!providers.some((item) => item.id === provider)) {
    throw new Error('provider is invalid');
  }

  return {
    provider: provider as ProviderId,
    model: typeof parsed.model === 'string' ? parsed.model : '',
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
    persist: parsed.persist !== false,
  };
}

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(projectsFile, 'utf8');
  } catch {
    await writeFile(projectsFile, '{}', 'utf8');
  }
}

async function loadProjects(): Promise<Record<string, unknown>> {
  await ensureStore();
  const raw = await readFile(projectsFile, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function saveProject(key: string, project: unknown) {
  const projects = await loadProjects();
  projects[key] = project;
  await writeFile(projectsFile, JSON.stringify(projects, null, 2), 'utf8');
}

async function ensureJobsStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(jobsFile, 'utf8');
  } catch {
    await writeFile(jobsFile, '{}', 'utf8');
  }
}

async function loadJobs() {
  await ensureJobsStore();
  const raw = await readFile(jobsFile, 'utf8');
  const parsed = raw.trim()
    ? JSON.parse(raw) as Record<string, AnalysisJob>
    : {};
  const now = Date.now();

  for (const job of Object.values(parsed)) {
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'error';
      job.error = 'Analysis service restarted before the job completed';
      job.completedAt = now;
    }
    jobs.set(job.id, job);
  }
}

async function saveJob(job: AnalysisJob) {
  const raw = await readFile(jobsFile, 'utf8').catch(() => '{}');
  let parsed: Record<string, AnalysisJob>;
  try {
    parsed = raw.trim() ? JSON.parse(raw) as Record<string, AnalysisJob> : {};
  } catch {
    parsed = {};
  }
  parsed[job.id] = job;
  await writeFile(jobsFile, JSON.stringify(parsed, null, 2), 'utf8');
}

function cacheKey(input: AnalysisRequest, commit: string) {
  return [input.repoUrl, input.provider, input.model, commit, input.language, analysisCacheRevision].join('|');
}

function publicJob(job: AnalysisJob) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.result ? backfillDecisionRationale(job.result, job.request.language) : undefined,
    error: job.error,
  };
}

function createJob(request: AnalysisRequest): AnalysisJob {
  if (request.provider === 'custom' && !validEndpoint(customEndpoint())) {
    throw new Error('CUSTOM_AI_ENDPOINT must be configured as a valid HTTP(S) URL');
  }

  if (request.provider !== 'mock' && providerApiKey(request.provider).length === 0) {
    throw new Error(`${providerEnvKeys[request.provider]} is not configured`);
  }

  const job: AnalysisJob = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    stage: request.language === 'zh' ? '排队等待分析' : 'Queued for analysis',
    request,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  jobQueue.push(job.id);
  void saveJob(job);
  log('analysis:queued', {
    jobId: job.id,
    repository: request.repoUrl,
    provider: request.provider,
    model: request.model,
    language: request.language,
  });
  return job;
}

function isTransientGitHubError(message: string) {
  return /terminated|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|empty response|GitHub request timed out/i.test(message);
}

function processQueue() {
  while (activeJobCount < maxConcurrentJobs && jobQueue.length > 0) {
    const jobId = jobQueue.shift();
    if (!jobId || !jobs.has(jobId)) continue;
    void runJob(jobId);
  }
}

async function runJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  activeJobCount += 1;
  try {
    let project;
    let lastError: Error | null = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      job.status = 'running';
      job.progress = 5;
      job.startedAt = Date.now();
      log('analysis:started', {
        jobId,
        attempt,
        repository: job.request.repoUrl,
        provider: job.request.provider,
        model: job.request.model,
      });

      try {
        project = await analyzeRepository({
          ...job.request,
          apiKey: providerApiKey(job.request.provider),
          endpoint: job.request.provider === 'custom' ? customEndpoint() : undefined,
          onProgress: (progress) => {
            job.progress = Math.max(job.progress, progress.progress);
            job.stage = progress.stage;
            log('analysis:progress', {
              jobId,
              progress: job.progress,
              stage: job.stage,
            });
          },
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Analysis failed');
        if (
          attempt < maxAttempts &&
          isTransientGitHubError(lastError.message)
        ) {
          const delayMs = 4000 * attempt;
          job.stage = job.request.language === 'zh'
            ? `网络波动，自动重试分析 (${attempt}/${maxAttempts - 1})`
            : `Network issue, retrying analysis (${attempt}/${maxAttempts - 1})`;
          log('analysis:retry', {
            jobId,
            attempt,
            error: lastError.message,
            delayMs,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw lastError;
      }
    }

    const key = cacheKey(job.request, project.commit);
    const projects = await loadProjects();
    const cached = job.request.force ? undefined : projects[key];
    const result = cached ?? project;
    log(job.request.force ? 'analysis:forced' : cached ? 'analysis:cache-hit' : 'analysis:cache-miss', {
      jobId,
      cacheKey: key,
    });
    if (!cached) {
      await saveProject(key, project);
    }

    job.result = result;
    job.status = 'complete';
    job.progress = 100;
    job.stage = job.request.language === 'zh' ? '分析完成' : 'Analysis complete';
    job.completedAt = Date.now();
    log('analysis:complete', {
      jobId,
      repository: (project as { repository?: string }).repository,
      commit: (project as { commit?: string }).commit,
      evidenceCount: (project as { evidence?: unknown[] }).evidence?.length ?? 0,
      durationMs: job.completedAt - (job.startedAt ?? job.createdAt),
    });
    void saveJob(job);
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : 'Analysis failed';
    job.completedAt = Date.now();
    log('analysis:error', {
      jobId,
      error: job.error,
      durationMs: job.completedAt - (job.startedAt ?? job.createdAt),
    });
    void saveJob(job);
  } finally {
    activeJobCount -= 1;
    processQueue();
  }
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'repolens-analysis-api' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/projects') {
    try {
      const projects = await loadProjects();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.keys(projects)));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to load projects' }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/history') {
    const history = Array.from(jobs.values())
      .filter((job) => job.status === 'complete')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 50)
      .map((job) => {
        const result = job.result as { name?: string; repository?: string; commit?: string; summary?: string } | undefined;
        return {
          jobId: job.id,
          name: result?.name ?? job.request.repoUrl,
          repository: result?.repository ?? job.request.repoUrl,
          commit: result?.commit ?? '',
          provider: job.request.provider,
          model: job.request.model,
          language: job.request.language,
          completedAt: job.completedAt ?? 0,
          summary: result?.summary ?? '',
        };
      });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/repositories') {
    const repositoryMap = new Map<string, {
      repository: string;
      name: string;
      analysisCount: number;
      latestJobId: string;
      latestCommit: string;
      latestCompletedAt: number;
      providers: string[];
      models: string[];
      summary: string;
    }>();

    for (const job of Array.from(jobs.values())
      .filter((item) => item.status === 'complete')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))) {
      const result = job.result as {
        name?: string;
        repository?: string;
        commit?: string;
        summary?: string;
      } | undefined;
      const repository = result?.repository ?? job.request.repoUrl;
      const existing = repositoryMap.get(repository);

      if (!existing) {
        repositoryMap.set(repository, {
          repository,
          name: result?.name ?? repository,
          analysisCount: 1,
          latestJobId: job.id,
          latestCommit: result?.commit ?? '',
          latestCompletedAt: job.completedAt ?? 0,
          providers: [job.request.provider],
          models: [job.request.model],
          summary: result?.summary ?? '',
        });
        continue;
      }

      existing.analysisCount += 1;
      if (!existing.providers.includes(job.request.provider)) {
        existing.providers.push(job.request.provider);
      }
      if (!existing.models.includes(job.request.model)) {
        existing.models.push(job.request.model);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Array.from(repositoryMap.values())));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    try {
      const input = parseAskRequest(await readBody(req));
      const project = findLatestProject(input.repoUrl) as import('../src/types.ts').Project | null;
      if (!project) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          answer: 'No analysis found for this repository. Analyze it first in New Analysis.',
        }));
        return;
      }

      log('ask:started', {
        repository: input.repoUrl,
        provider: input.provider,
        model: input.model,
        question: input.question.slice(0, 160),
      });

      const startedAt = Date.now();
      let result: AskResult;
      if (input.provider === 'mock') {
        result = buildMockAskResult(project, input.question);
      } else {
        const prompt = buildAskPrompt(project, input.question, input.language);
        const raw = await withTimeout(callAI({
          provider: input.provider,
          apiKey: providerApiKey(input.provider),
          model: input.model,
          prompt,
          endpoint: input.provider === 'custom' ? customEndpoint() : undefined,
          jsonMode: true,
        }), 120_000);
        const parsed = parseAskResponse(raw, project);
        if (!parsed) throw new Error('AI answer was not valid JSON');
        result = parsed;
      }

      log('ask:complete', {
        repository: input.repoUrl,
        provider: input.provider,
        citations: result.evidenceIds.length,
        durationMs: Date.now() - startedAt,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ask failed';
      log('ask:error', { error: message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answer: message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/providers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(publicProviders()));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/provider/config') {
    try {
      const input = parseProviderRequest(await readBody(req));
      const envKey = providerEnvKeys[input.provider];

      if (input.provider === 'mock') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Mock provider does not need configuration' }));
        return;
      }

      if (!envKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provider environment key is not defined' }));
        return;
      }

      const selectedApiKey = input.apiKey.trim();
      if (selectedApiKey.length === 0 && providerApiKey(input.provider).length === 0) {
        throw new Error('API key is required');
      }

      let nextEndpoint = customEndpoint();
      if (input.provider === 'custom') {
        nextEndpoint = input.endpoint.trim() || nextEndpoint;
        if (!validEndpoint(nextEndpoint)) {
          throw new Error('A valid HTTP(S) endpoint is required');
        }
      }

      if (selectedApiKey) {
        process.env[envKey ?? ''] = selectedApiKey;
      }
      if (input.provider === 'custom') {
        process.env.CUSTOM_AI_ENDPOINT = nextEndpoint;
      }
      const nextModel = input.model.trim();
      const modelEnvKey = providerModelEnvKeys[input.provider];
      if (nextModel && modelEnvKey) {
        process.env[modelEnvKey] = nextModel;
      }
      if (input.persist) {
        if (selectedApiKey && envKey) {
          await saveEnvValue(envKey, selectedApiKey);
        }
        if (input.provider === 'custom') {
          await saveEnvValue('CUSTOM_AI_ENDPOINT', nextEndpoint);
        }
        if (nextModel && modelEnvKey) {
          await saveEnvValue(modelEnvKey, nextModel);
        }
      }

      log('provider:configured', {
        provider: input.provider,
        envKey,
        persisted: input.persist,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        provider: input.provider,
        envKey,
        configured: true,
        persisted: input.persist,
        model: nextModel,
        endpoint: input.provider === 'custom' ? nextEndpoint : undefined,
      }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Provider configuration failed' }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/providers/models') {
    const startedAt = Date.now();
    try {
      const input = parseProviderRequest(await readBody(req));
      const apiKey = input.apiKey.trim() || providerApiKey(input.provider);
      if (input.provider !== 'mock' && apiKey.length === 0) {
        throw new Error(`${providerEnvKeys[input.provider]} is not configured`);
      }

      const endpoint = input.provider === 'custom'
        ? input.endpoint.trim() || customEndpoint()
        : undefined;
      if (input.provider === 'custom' && !validEndpoint(endpoint ?? '')) {
        throw new Error('CUSTOM_AI_ENDPOINT must be configured as a valid HTTP(S) URL');
      }

      log('provider:models:started', {
        provider: input.provider,
      });

      const models = await fetchModels({
        provider: input.provider,
        apiKey,
        endpoint,
      });
      const latencyMs = Date.now() - startedAt;

      log('provider:models:complete', {
        provider: input.provider,
        modelCount: models.length,
        latencyMs,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        provider: input.provider,
        models,
        latencyMs,
      }));
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'Model fetch failed';

      log('provider:models:error', {
        provider: 'unknown',
        error: message,
        latencyMs,
      });

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: message,
        latencyMs,
      }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/provider/test') {
    const startedAt = Date.now();
    try {
      const input = parseProviderRequest(await readBody(req));
      if (input.model.trim().length === 0) {
        throw new Error('model is required');
      }

      const apiKey = input.apiKey.trim() || providerApiKey(input.provider);
      if (input.provider !== 'mock' && apiKey.length === 0) {
        throw new Error(`${providerEnvKeys[input.provider]} is not configured`);
      }

      const endpoint = input.provider === 'custom'
        ? input.endpoint.trim() || customEndpoint()
        : undefined;
      if (input.provider === 'custom' && !validEndpoint(endpoint ?? '')) {
        throw new Error('CUSTOM_AI_ENDPOINT must be configured as a valid HTTP(S) URL');
      }

      log('provider:test:started', {
        provider: input.provider,
        model: input.model,
      });

      const responseText = await callAI({
        provider: input.provider,
        apiKey,
        model: input.model,
        prompt: 'Reply with exactly: connected',
        endpoint,
      });
      const latencyMs = Date.now() - startedAt;

      log('provider:test:complete', {
        provider: input.provider,
        model: input.model,
        latencyMs,
        responseLength: responseText.length,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        provider: input.provider,
        model: input.model,
        latencyMs,
        responsePreview: responseText.slice(0, 120),
      }));
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'Provider test failed';

      log('provider:test:error', {
        provider: 'unknown',
        error: message,
        latencyMs,
      });

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: message,
        latencyMs,
      }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/analyze') {
    try {
      const body = await readBody(req);
      const input = parseRequest(body);
      const job = createJob(input);
      processQueue();
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(publicJob(job)));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Analysis failed' }));
    }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/analysis/')) {
    const jobId = req.url.slice('/api/analysis/'.length);
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Analysis job not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(publicJob(job)));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

await loadJobs();

server.listen(port, () => {
  console.log(`RepoLens analysis API listening on http://127.0.0.1:${port}`);
});
