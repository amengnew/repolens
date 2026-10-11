import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeRepository } from '../src/ai/analyze.ts';
import { compareProjects, type ComparisonResult } from '../src/ai/comparison.ts';

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

type ProviderId = 'mock' | 'openai' | 'deepseek' | 'anthropic' | 'gemini';
type Language = 'en' | 'zh';

interface AnalysisRequest {
  repoUrl: string;
  provider: ProviderId;
  model: string;
  language: Language;
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

function parseRequest(body: string): AnalysisRequest {
  const parsed = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Request body must be an object');
  }

  const { repoUrl, provider, model, language } = parsed as Partial<AnalysisRequest>;
  if (typeof repoUrl !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(repoUrl)) {
    throw new Error('repoUrl must be a GitHub repository URL');
  }
  if (!['mock', 'openai', 'deepseek', 'anthropic', 'gemini'].includes(provider ?? '')) {
    throw new Error('provider is invalid');
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('model must be a non-empty string');
  }
  if (language !== 'en' && language !== 'zh') {
    throw new Error('language must be en or zh');
  }

  return { repoUrl, provider, model, language };
}

const providerEnvKeys: Record<ProviderId, string | null> = {
  mock: null,
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

function providerApiKey(provider: ProviderId) {
  const envKey = providerEnvKeys[provider];
  return envKey ? process.env[envKey] ?? '' : '';
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
  return [input.repoUrl, input.provider, input.model, commit, input.language].join('|');
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
    result: job.result,
    error: job.error,
  };
}

function createJob(request: AnalysisRequest): AnalysisJob {
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
  return job;
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
  job.status = 'running';
  job.progress = 5;
  job.startedAt = Date.now();

  try {
    const project = await analyzeRepository({
      ...job.request,
      apiKey: providerApiKey(job.request.provider),
      onProgress: (progress) => {
      job.progress = Math.max(job.progress, progress.progress);
      job.stage = progress.stage;
      },
    });

    const key = cacheKey(job.request, project.commit);
    const projects = await loadProjects();
    const cached = projects[key];
    const result = cached ?? project;
    if (!cached) {
      await saveProject(key, project);
    }

    job.result = result;
    job.status = 'complete';
    job.progress = 100;
    job.stage = job.request.language === 'zh' ? '分析完成' : 'Analysis complete';
    job.completedAt = Date.now();
    void saveJob(job);
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : 'Analysis failed';
    job.completedAt = Date.now();
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

  if (req.method === 'GET' && req.url?.startsWith('/api/compare/')) {
    const [baseJobId, targetJobId] = req.url
      .slice('/api/compare/'.length)
      .split('/')
      .map((value) => decodeURIComponent(value));

    const baseJob = jobs.get(baseJobId ?? '');
    const targetJob = jobs.get(targetJobId ?? '');
    if (!baseJob?.result || !targetJob?.result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Both analysis jobs must exist and be complete' }));
      return;
    }

    const result = compareProjects(baseJob.result as never, targetJob.result as never, {
      base: {
        jobId: baseJob.id,
        provider: baseJob.request.provider,
        model: baseJob.request.model,
        language: baseJob.request.language,
        completedAt: baseJob.completedAt ?? 0,
      },
      target: {
        jobId: targetJob.id,
        provider: targetJob.request.provider,
        model: targetJob.request.model,
        language: targetJob.request.language,
        completedAt: targetJob.completedAt ?? 0,
      },
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

await loadJobs();

server.listen(port, () => {
  console.log(`RepoLens analysis API listening on http://127.0.0.1:${port}`);
});
