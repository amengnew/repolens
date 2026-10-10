import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
      const project = await analyzeRepository(input);
      const key = cacheKey(input, project.commit);
      const projects = await loadProjects();
      const cached = projects[key];
      if (cached) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      await saveProject(key, project);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(project));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Analysis failed' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`RepoLens analysis API listening on http://127.0.0.1:${port}`);
});
