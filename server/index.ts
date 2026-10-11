import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeRepository } from '../src/ai/analyze.ts';

const port = 3001;
const dataDir = path.resolve(process.cwd(), '.data');
const projectsFile = path.join(dataDir, 'projects.json');

type ProviderId = 'mock' | 'openai' | 'deepseek' | 'anthropic' | 'gemini';
type Language = 'en' | 'zh';

interface AnalysisRequest {
  repoUrl: string;
  provider: ProviderId;
  apiKey: string;
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

  const { repoUrl, provider, apiKey, model, language } = parsed as Partial<AnalysisRequest>;
  if (typeof repoUrl !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(repoUrl)) {
    throw new Error('repoUrl must be a GitHub repository URL');
  }
  if (!['mock', 'openai', 'deepseek', 'anthropic', 'gemini'].includes(provider ?? '')) {
    throw new Error('provider is invalid');
  }
  if (typeof apiKey !== 'string') {
    throw new Error('apiKey must be a string');
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('model must be a non-empty string');
  }
  if (language !== 'en' && language !== 'zh') {
    throw new Error('language must be en or zh');
  }

  return { repoUrl, provider, apiKey, model, language };
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
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : 'Analysis failed';
    job.completedAt = Date.now();
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

server.listen(port, () => {
  console.log(`RepoLens analysis API listening on http://127.0.0.1:${port}`);
});
