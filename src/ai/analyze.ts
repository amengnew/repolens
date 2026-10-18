import type { Project } from '../types.ts';
import type { Language } from '../i18n.tsx';
import { sampleProject } from '../data/sampleProject.ts';
import { callAI, type ProviderId } from './providers.ts';
import { analyzeStaticFiles, type StaticAnalysisResult } from './staticAnalysis.ts';

export interface AnalyzeOptions {
  repoUrl: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
  endpoint?: string;
  language: Language;
  onProgress?: (progress: AnalysisProgress) => void;
}

export interface AnalysisProgress {
  progress: number;
  stage: string;
}

interface SimplifiedAnalysis {
  name?: string;
  summary?: string;
  techStack?: string[];
  coreModules?: string[];
  importantFiles?: string[];
  entries?: Array<{
    id?: string;
    name?: string;
    role?: string;
    kind?: string;
    input?: string;
    auth?: string;
    permissions?: string[];
    flowId?: string;
    sourcePath?: string;
    sourceQuote?: string;
  }>;
  flows?: Array<{
    id?: string;
    name?: string;
    trigger?: string;
    description?: string;
    steps?: string[];
    errorPaths?: string[];
    sourcePath?: string;
    sourceQuote?: string;
  }>;
  decisions?: Array<{
    id?: string;
    title?: string;
    topic?: string;
    problem?: string;
    solution?: string;
    parameters?: Array<{ key: string; value: string }>;
    rationale?: string;
    alternatives?: string[];
    tradeoffs?: string[];
    sourcePath?: string;
    sourceQuote?: string;
  }>;
}

interface RepositoryFile {
  path: string;
  content: string;
}

interface RepositoryContext {
  owner: string;
  name: string;
  description: string;
  defaultBranch: string;
  commit: string;
  paths: string[];
  selectedFiles: RepositoryFile[];
  staticAnalysis: StaticAnalysisResult;
}

function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

function githubHeaders(accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Connection: 'close',
    'User-Agent': 'repolens-analysis',
  };
}

async function githubFetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: githubHeaders() });
      if (!response.ok) {
        throw new Error(`GitHub request failed: ${response.status}`);
      }
      const text = await response.text();
      if (!text.trim()) {
        throw new Error('GitHub returned an empty response');
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('GitHub request failed');
}

async function githubFetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Connection: 'close', 'User-Agent': 'repolens-analysis' },
      });
      if (!response.ok) throw new Error(`raw file request failed: ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('raw file request failed');
}

async function fetchRepositoryContext(
  repoUrl: string,
  language: Language,
  onProgress?: (progress: AnalysisProgress) => void,
): Promise<RepositoryContext> {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  onProgress?.({
    progress: 10,
    stage: language === 'zh' ? '读取仓库元数据' : 'Fetching repository metadata',
  });
  const repoData = await githubFetchJson(`https://api.github.com/repos/${owner}/${repo}`) as {
    name?: string;
    description?: string;
    default_branch?: string;
  };
  onProgress?.({
    progress: 25,
    stage: language === 'zh' ? '固定 commit' : 'Pinning commit',
  });
  const commitData = await githubFetchJson(
    `https://api.github.com/repos/${owner}/${repo}/commits/${repoData.default_branch ?? 'main'}`,
  ) as { sha?: string };
  const commit = commitData.sha;
  if (!commit) {
    throw new Error('GitHub commit response is missing sha');
  }

  onProgress?.({
    progress: 40,
    stage: language === 'zh' ? '读取文件树' : 'Reading repository tree',
  });
  const treeData = await githubFetchJson(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`,
  ) as { tree?: Array<{ type?: string; path?: string }> };

  const paths = (treeData.tree ?? [])
    .filter((item) => item.type === 'blob')
    .map((item) => item.path ?? '')
    .filter(Boolean);

  const relevantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.md', '.json', '.yaml', '.yml'];
  const relevantPaths: string[] = paths.filter((path: string) =>
    relevantExtensions.some((extension) => path.endsWith(extension)) &&
    !path.includes('node_modules/') &&
    !path.includes('dist/'),
  );
  const priorityPaths: Array<{ path: string; score: number }> = relevantPaths
    .map((path: string) => {
      let score = 0;
      if (/readme/i.test(path)) score += 100;
      if (/package\.json$|pyproject\.toml$|go\.mod$/.test(path)) score += 80;
      if (/^(src|app|server|packages|apps)\//.test(path)) score += 50;
      if (/(route|controller|server|entry|index|main|app)\./i.test(path)) score += 30;
      if (/(test|spec|fixture|mock)\./i.test(path)) score -= 30;
      return { path, score };
    })
    .sort((a, b) => b.score - a.score);
  const selectedPaths = priorityPaths.slice(0, 12).map((item: { path: string }) => item.path);

  onProgress?.({
    progress: 55,
    stage: language === 'zh' ? '下载关键源码文件' : 'Downloading key source files',
  });
  const filePromises = selectedPaths.map(async (path: string) => {
    try {
      const text = await githubFetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${path}`);
      return { path, content: text.slice(0, 6000) };
    } catch {
      return { path, content: '' };
    }
  });
  const files = await Promise.all(filePromises);

  const staticAnalysis = analyzeStaticFiles(files);

  return {
    owner,
    name: repoData.name ?? repo,
    description: repoData.description ?? '',
    defaultBranch: repoData.default_branch ?? 'main',
    commit,
    paths,
    selectedFiles: files,
    staticAnalysis,
  };
}

function buildPrompt(context: RepositoryContext, language: Language) {
  return `You are analyzing the GitHub repository ${context.name}.

Repository description: ${context.description}

Selected files:
${context.selectedFiles.map((file) => `\n--- ${file.path} ---\n${file.content}`).join('\n')}

Static analysis result:
${JSON.stringify(context.staticAnalysis, null, 2)}

Return only valid JSON with this exact shape:
{
  "name": string,
  "summary": string,
  "techStack": string[],
  "coreModules": string[],
  "importantFiles": string[],
  "entries": [{"id":string,"name":string,"role":string,"kind":"ui"|"http"|"cli"|"event"|"job"|"tool"|"websocket","input":string,"auth":string,"permissions":string[],"flowId":string,"sourcePath":string,"sourceQuote":string}],
  "flows": [{"id":string,"name":string,"trigger":string,"description":string,"steps":string[],"errorPaths":string[],"sourcePath":string,"sourceQuote":string}],
  "decisions": [{"id":string,"title":string,"topic":string,"problem":string,"solution":string,"parameters":[{"key":string,"value":string}],"rationale":string,"alternatives":string[],"tradeoffs":string[],"sourcePath":string,"sourceQuote":string}]
}

Focus on user-facing entry points, the chain of logic they trigger, and engineering trade-offs.
Use the static analysis result as high-confidence evidence for routes, commands, event handlers, and jobs. Prefer these entries over inferred ones.
The role field must be one of: "End user", "Admin", "Developer", "System", "External service".
Use sourcePath and sourceQuote only when the selected files contain the supporting code. sourceQuote must be copied verbatim from that file.
Return all user-facing text in ${language === 'zh' ? 'Simplified Chinese' : 'English'}.
Do not include Markdown fences.
Your final answer must start with { and end with }. Missing fields use empty arrays or empty strings. Do not explain what you are doing.`;
}

function buildCompactContext(context: RepositoryContext) {
  const priorityFiles = [...context.selectedFiles].sort((a, b) => {
    const pathScore = (path: string) =>
      (/readme/i.test(path) ? 100 : 0) + (/^src\//.test(path) ? 30 : 0);
    return pathScore(b.path) - pathScore(a.path);
  }).slice(0, 6);

  return `Repository: ${context.name}
Description: ${context.description}
Commit: ${context.commit}

Selected source files:
${priorityFiles.map((file) => `\n--- ${file.path} ---\n${file.content.slice(0, 5000)}`).join('\n')}

Static analysis result:
${JSON.stringify(context.staticAnalysis, null, 2)}`;
}

function buildRepairPrompt(
  previousText: string,
  context: RepositoryContext,
  language: Language,
  errorMessage?: string,
) {
  const previousSection = previousText.trim().length > 0
    ? `Here is the exact previous response:
---BEGIN PREVIOUS RESPONSE---
${previousText.slice(0, 120_000)}
---END PREVIOUS RESPONSE---`
    : '';

  return `A repository analysis of ${context.name} was supposed to return one JSON object, but the response could not be used.

${previousSection}

Repository context for grounding:
${buildCompactContext(context)}

Validation error: ${errorMessage ?? 'the response was not valid JSON'}

Repair it into exactly one valid JSON object with this shape:
{
  "name": string,
  "summary": string,
  "techStack": string[],
  "coreModules": string[],
  "importantFiles": string[],
  "entries": [{"id":string,"name":string,"role":"End user"|"Admin"|"Developer"|"System"|"External service","kind":"ui"|"http"|"cli"|"event"|"job"|"tool"|"websocket","input":string,"auth":string,"permissions":string[],"flowId":string,"sourcePath":string,"sourceQuote":string}],
  "flows": [{"id":string,"name":string,"trigger":string,"description":string,"steps":string[],"errorPaths":string[],"sourcePath":string,"sourceQuote":string}],
  "decisions": [{"id":string,"title":string,"topic":string,"problem":string,"solution":string,"parameters":[{"key":string,"value":string}],"rationale":string,"alternatives":string[],"tradeoffs":string[],"sourcePath":string,"sourceQuote":string}]
}

The shape above is a schema only; it contains no data about ${context.name}. Every string value must be real repository data, never schema text such as "string" or placeholder names.
${previousSection ? 'Keep every valid part of the previous response that describes the repository. ' : ''}Do not echo your instructions, the schema, or any example. Write one complete JSON object about ${context.name} with real entry, flow, and decision data. Return all user-facing text in ${language === 'zh' ? 'Simplified Chinese' : 'English'}. Your final answer must contain only valid JSON.`;
}

const validEntryKinds = ['http', 'ui', 'cli', 'event', 'job', 'tool', 'websocket'];
const validRoles = ['End user', 'Admin', 'Developer', 'System', 'External service'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function unwrapAnalysisRecord(record: Record<string, unknown>): Record<string, unknown> {
  if (normalizeOptionalString(record.name) || normalizeOptionalString(record.summary)) {
    return record;
  }
  for (const key of ['data', 'result', 'analysis', 'project']) {
    const nested = record[key];
    if (!isRecord(nested)) continue;
    if (
      normalizeOptionalString(nested.name) ||
      normalizeOptionalString(nested.summary) ||
      Array.isArray(nested.entries) ||
      Array.isArray(nested.flows) ||
      Array.isArray(nested.decisions)
    ) {
      return nested;
    }
  }
  return record;
}

type AnalysisEntry = NonNullable<SimplifiedAnalysis['entries']>[number];
type AnalysisFlow = NonNullable<SimplifiedAnalysis['flows']>[number];
type AnalysisDecision = NonNullable<SimplifiedAnalysis['decisions']>[number];

function normalizeEntry(value: unknown, index: number): AnalysisEntry | null {
  if (!isRecord(value)) return null;
  const record = value as Record<string, unknown>;
  const name = normalizeOptionalString(record.name);
  if (!name) return null;
  return {
    id: normalizeOptionalString(record.id) ?? `entry-${index}`,
    name,
    role: typeof record.role === 'string' && validRoles.includes(record.role) ? record.role : 'Developer',
    kind: typeof record.kind === 'string' && validEntryKinds.includes(record.kind) ? record.kind : 'tool',
    input: normalizeOptionalString(record.input) ?? '',
    auth: normalizeOptionalString(record.auth) ?? '',
    permissions: normalizeStringArray(record.permissions),
    flowId: normalizeOptionalString(record.flowId),
    sourcePath: normalizeOptionalString(record.sourcePath),
    sourceQuote: normalizeOptionalString(record.sourceQuote),
  };
}

function normalizeFlow(value: unknown, index: number): AnalysisFlow | null {
  if (!isRecord(value)) return null;
  const record = value as Record<string, unknown>;
  const name = normalizeOptionalString(record.name);
  if (!name) return null;
  return {
    id: normalizeOptionalString(record.id) ?? `flow-${index}`,
    name,
    trigger: normalizeOptionalString(record.trigger) ?? '',
    description: normalizeOptionalString(record.description) ?? '',
    steps: normalizeStringArray(record.steps),
    errorPaths: normalizeStringArray(record.errorPaths),
    sourcePath: normalizeOptionalString(record.sourcePath),
    sourceQuote: normalizeOptionalString(record.sourceQuote),
  };
}

function normalizeDecision(value: unknown, index: number): AnalysisDecision | null {
  if (!isRecord(value)) return null;
  const record = value as Record<string, unknown>;
  const title = normalizeOptionalString(record.title);
  if (!title) return null;
  const parameters = Array.isArray(record.parameters)
    ? record.parameters
        .filter((parameter): parameter is Record<string, unknown> => isRecord(parameter))
        .filter((parameter) => typeof parameter.key === 'string' && typeof parameter.value === 'string')
        .map((parameter) => ({ key: parameter.key as string, value: parameter.value as string }))
    : [];
  return {
    id: normalizeOptionalString(record.id) ?? `decision-${index}`,
    title,
    topic: normalizeOptionalString(record.topic) ?? '',
    problem: normalizeOptionalString(record.problem) ?? '',
    solution: normalizeOptionalString(record.solution) ?? '',
    parameters,
    rationale: normalizeOptionalString(record.rationale) ?? '',
    alternatives: normalizeStringArray(record.alternatives),
    tradeoffs: normalizeStringArray(record.tradeoffs),
    sourcePath: normalizeOptionalString(record.sourcePath),
    sourceQuote: normalizeOptionalString(record.sourceQuote),
  };
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function findLargestValidJsonObject(text: string): unknown | null {
  let best: unknown = null;
  let bestLength = 0;

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) continue;

    const candidate = text.slice(start, end + 1);
    if (candidate.length <= bestLength) continue;
    try {
      const parsed = JSON.parse(candidate);
      best = parsed;
      bestLength = candidate.length;
    } catch {
      // Skip prose that happens to contain JSON-style braces.
    }
  }

  return best;
}

export function parseAIResponse(text: string): SimplifiedAnalysis {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const extracted = extractJsonObject(text);
    if (extracted !== null) {
      try {
        parsed = JSON.parse(extracted);
      } catch {
        // Try the larger scan below.
      }
    }
    if (parsed === undefined) {
      parsed = findLargestValidJsonObject(text);
    }
    if (parsed === null || parsed === undefined) {
      throw new Error(`AI response is not valid JSON: ${trimmed.slice(0, 200)}`);
    }
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('AI response is not an object');
  const record = unwrapAnalysisRecord(parsed as Record<string, unknown>);
  return {
    name: normalizeOptionalString(record.name),
    summary: normalizeOptionalString(record.summary),
    techStack: normalizeStringArray(record.techStack),
    coreModules: normalizeStringArray(record.coreModules),
    importantFiles: normalizeStringArray(record.importantFiles),
    entries: Array.isArray(record.entries)
      ? record.entries
          .map((entry, index) => normalizeEntry(entry, index))
          .filter((entry): entry is AnalysisEntry => entry !== null)
      : [],
    flows: Array.isArray(record.flows)
      ? record.flows
          .map((flow, index) => normalizeFlow(flow, index))
          .filter((flow): flow is AnalysisFlow => flow !== null)
      : [],
    decisions: Array.isArray(record.decisions)
      ? record.decisions
          .map((decision, index) => normalizeDecision(decision, index))
          .filter((decision): decision is AnalysisDecision => decision !== null)
      : [],
  };
}

export function isSubstantiveAnalysis(analysis: SimplifiedAnalysis | null): boolean {
  if (!analysis) return false;
  return (
    (analysis.entries?.length ?? 0) > 0 ||
    (analysis.flows?.length ?? 0) > 0 ||
    (analysis.decisions?.length ?? 0) > 0
  );
}

function looksLikeTemplateEcho(analysis: SimplifiedAnalysis): boolean {
  const sample = [
    analysis.name,
    analysis.summary,
    ...(analysis.entries ?? []).map((entry) => entry.name),
    ...(analysis.flows ?? []).map((flow) => flow.name),
    ...(analysis.decisions ?? []).map((decision) => decision.title),
  ].join(' ').toLowerCase();
  return /example-repo|one sentence about|schema only|placeholder|your-repository|your-repo|lorem ipsum/.test(sample);
}

function staticFallback(
  context: RepositoryContext,
  language: Language,
): { entries: AnalysisEntry[]; flows: AnalysisFlow[] } {
  const entries: AnalysisEntry[] = [];
  const flows: AnalysisFlow[] = [];
  const seen = new Set<string>();

  for (const route of context.staticAnalysis.routes) {
    const key = `http|${route.method}|${route.path}|${route.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flowId = `static-flow-${flows.length + 1}`;
    flows.push({
      id: flowId,
      name: `${route.method} ${route.path}`,
      trigger: language === 'zh' ? `${route.method} 请求 ${route.path}` : `${route.method} request to ${route.path}`,
      description: language === 'zh'
        ? `由 ${route.file} 中的 ${route.framework} 路由处理`
        : `Handled by a ${route.framework} route in ${route.file}`,
      steps: [
        language === 'zh' ? `接收 ${route.method} ${route.path} 请求` : `Receive ${route.method} ${route.path} request`,
        language === 'zh' ? `调度到 ${route.file} 中的处理器` : `Dispatch to the handler in ${route.file}`,
        language === 'zh' ? '执行业务逻辑' : 'Execute business logic',
        language === 'zh' ? '返回响应' : 'Return response',
      ],
      errorPaths: [],
      sourcePath: route.file,
    });
    entries.push({
      id: `static-entry-${entries.length + 1}`,
      name: `${route.method} ${route.path}`,
      role: 'End user',
      kind: 'http',
      input: route.path,
      auth: '',
      permissions: [],
      flowId,
      sourcePath: route.file,
    });
  }

  for (const command of context.staticAnalysis.commands) {
    const key = `cli|${command.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flowId = `static-flow-${flows.length + 1}`;
    flows.push({
      id: flowId,
      name: language === 'zh' ? `命令 ${command.name}` : `Command ${command.name}`,
      trigger: language === 'zh' ? `执行 ${command.name}` : `Run ${command.name}`,
      description: language === 'zh'
        ? `由 ${command.file} 定义（${command.source}）`
        : `Defined in ${command.file} (${command.source})`,
      steps: [
        language === 'zh' ? `调用 ${command.name}` : `Invoke ${command.name}`,
        language === 'zh' ? `解析 ${command.file} 中的参数` : `Parse arguments in ${command.file}`,
        language === 'zh' ? '执行命令逻辑' : 'Execute command logic',
      ],
      errorPaths: [],
      sourcePath: command.file,
    });
    entries.push({
      id: `static-entry-${entries.length + 1}`,
      name: language === 'zh' ? `运行 ${command.name}` : `Run ${command.name}`,
      role: 'Developer',
      kind: 'cli',
      input: command.name,
      auth: '',
      permissions: [],
      flowId,
      sourcePath: command.file,
    });
  }

  for (const handler of context.staticAnalysis.eventHandlers) {
    const key = `event|${handler.event}|${handler.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flowId = `static-flow-${flows.length + 1}`;
    flows.push({
      id: flowId,
      name: language === 'zh' ? `事件 ${handler.event}` : `Event ${handler.event}`,
      trigger: language === 'zh' ? `触发 ${handler.event}` : `${handler.event} fires`,
      description: language === 'zh'
        ? `监听器位于 ${handler.file}`
        : `Listener defined in ${handler.file}`,
      steps: [
        language === 'zh' ? `监听 ${handler.event} 事件` : `Listen for ${handler.event}`,
        language === 'zh' ? `执行 ${handler.file} 中的回调` : `Run the callback in ${handler.file}`,
      ],
      errorPaths: [],
      sourcePath: handler.file,
    });
    entries.push({
      id: `static-entry-${entries.length + 1}`,
      name: handler.event,
      role: 'System',
      kind: 'event',
      input: handler.event,
      auth: '',
      permissions: [],
      flowId,
      sourcePath: handler.file,
    });
  }

  for (const job of context.staticAnalysis.jobs) {
    const key = `job|${job.name}|${job.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flowId = `static-flow-${flows.length + 1}`;
    flows.push({
      id: flowId,
      name: language === 'zh' ? `定时任务 ${job.name}` : `Job ${job.name}`,
      trigger: job.schedule
        ? language === 'zh' ? `按计划 ${job.schedule} 触发` : `Triggered on schedule ${job.schedule}`
        : language === 'zh' ? '按内部时机触发' : 'Triggered by an internal cadence',
      description: language === 'zh'
        ? `任务定义位于 ${job.file}`
        : `Job defined in ${job.file}`,
      steps: [
        language === 'zh' ? `启动 ${job.name} 任务` : `Start the ${job.name} job`,
        language === 'zh' ? `执行 ${job.file} 中的处理逻辑` : `Run the processing logic in ${job.file}`,
      ],
      errorPaths: [],
      sourcePath: job.file,
    });
    entries.push({
      id: `static-entry-${entries.length + 1}`,
      name: job.name,
      role: 'System',
      kind: 'job',
      input: job.schedule ?? '',
      auth: '',
      permissions: [],
      flowId,
      sourcePath: job.file,
    });
  }

  return { entries, flows };
}

function findEvidenceLocation(file: RepositoryFile, quote: string) {
  const lines = file.content.split(/\r?\n/);
  const normalizedQuote = quote.trim().replace(/\s+/g, ' ');

  for (let start = 0; start < lines.length; start += 1) {
    const windowSize = Math.min(lines.length, 12);
    for (let size = 1; size <= windowSize; size += 1) {
      const candidate = lines.slice(start, start + size).join(' ').replace(/\s+/g, ' ').trim();
      if (candidate === normalizedQuote) {
        return { startLine: start + 1, endLine: start + size, code: lines.slice(start, start + size).join('\n') };
      }
    }
  }

  return null;
}

function createEvidence(options: {
  id: string;
  label: string;
  sourcePath?: string;
  sourceQuote?: string;
  context: RepositoryContext;
}): { evidence: Project['evidence'][number] | null; index: number } {
  if (!options.sourcePath) return { evidence: null, index: -1 };

  const file = options.context.selectedFiles.find((item) => item.path === options.sourcePath);
  if (!file) {
    return {
      evidence: {
        id: options.id,
        label: options.label,
        file: options.sourcePath,
        startLine: 1,
        endLine: 1,
        code: options.sourceQuote?.slice(0, 800) ?? 'Source quote unavailable.',
        confidence: 'inferred',
      },
      index: 0,
    };
  }

  if (options.sourceQuote) {
    const location = findEvidenceLocation(file, options.sourceQuote);
    if (location) {
      return {
        evidence: {
          id: options.id,
          label: options.label,
          file: file.path,
          ...location,
          confidence: 'source verified',
        },
        index: 0,
      };
    }
  }

  return {
    evidence: {
      id: options.id,
      label: options.label,
      file: file.path,
      startLine: 1,
      endLine: Math.min(12, file.content.split(/\r?\n/).length),
      code: file.content.split(/\r?\n/).slice(0, 12).join('\n'),
      confidence: 'doc verified',
    },
    index: 0,
  };
}

function appendEvidence(
  evidence: Project['evidence'],
  result: { evidence: Project['evidence'][number] | null; index: number },
) {
  if (!result.evidence) return [];
  evidence.push(result.evidence);
  return [result.evidence.id];
}

export function toProject(
  analysis: SimplifiedAnalysis,
  context: RepositoryContext,
  language: Language,
): Project {
  const evidence: Project['evidence'] = [];
  const staticFill = staticFallback(context, language);
  const analysisEntries = analysis.entries?.length ? analysis.entries : staticFill.entries;
  const analysisFlows = analysis.flows?.length ? analysis.flows : staticFill.flows;
  const analysisDecisions = analysis.decisions?.length ? analysis.decisions : [];

  const flows = analysisFlows.map((flow, flowIndex) => {
    const flowId = flow.id ?? `flow-${flowIndex}`;
    const flowEvidence = createEvidence({
      id: `ev-${flowId}`,
      label: flow.name ?? `Flow ${flowIndex + 1}`,
      sourcePath: flow.sourcePath,
      sourceQuote: flow.sourceQuote,
      context,
    });
    const flowEvidenceIds = appendEvidence(evidence, flowEvidence);
    const steps = flow.steps ?? [];
    const nodes = steps.map((step, index) => {
      const nodeEvidence = createEvidence({
        id: `ev-${flowId}-node-${index}`,
        label: step,
        sourcePath: flow.sourcePath,
        sourceQuote: flow.sourceQuote,
        context,
      });
      const evidenceIds = nodeEvidence.evidence
        ? appendEvidence(evidence, nodeEvidence)
        : flowEvidenceIds;
      return {
        id: `${flowId}-node-${index}`,
      label: step,
        type: 'service' as Project['flows'][number]['nodes'][number]['type'],
      description: step,
        evidenceIds,
      decisionIds: [],
      position: { x: index * 220, y: 160 },
      };
    });
    const edges = nodes.slice(0, -1).map((node, index) => ({
      id: `${flowId}-edge-${index}`,
      source: node.id,
      target: nodes[index + 1].id,
      label: 'next',
      kind: 'call' as Project['flows'][number]['edges'][number]['kind'],
    }));
    return {
      id: flowId,
      name: flow.name ?? `Flow ${flowIndex + 1}`,
      trigger: flow.trigger ?? '',
      description: flow.description ?? '',
      nodes,
      edges,
      errorPaths: flow.errorPaths ?? [],
    };
  });

  const entries = analysisEntries.map((entry, index) => {
    const entryEvidence = createEvidence({
      id: `ev-entry-${entry.id ?? index}`,
      label: entry.name ?? `Entry ${index + 1}`,
      sourcePath: entry.sourcePath,
      sourceQuote: entry.sourceQuote,
      context,
    });
    return {
      id: entry.id ?? `entry-${index}`,
      name: entry.name ?? `Entry ${index + 1}`,
      role: (entry.role as Project['entries'][number]['role']) ?? 'Developer',
      kind: (entry.kind as Project['entries'][number]['kind']) ?? 'http',
      input: entry.input ?? '',
      auth: entry.auth ?? '',
      permissions: entry.permissions ?? [],
      flowId: entry.flowId ?? flows[0]?.id ?? '',
      evidenceIds: appendEvidence(evidence, entryEvidence),
    };
  });

  const decisions = analysisDecisions.map((decision, index) => {
    const decisionEvidence = createEvidence({
      id: `ev-decision-${decision.id ?? index}`,
      label: decision.title ?? `Decision ${index + 1}`,
      sourcePath: decision.sourcePath,
      sourceQuote: decision.sourceQuote,
      context,
    });
    return {
      id: decision.id ?? `decision-${index}`,
      title: decision.title ?? `Decision ${index + 1}`,
      topic: decision.topic ?? '',
      problem: decision.problem ?? '',
      solution: decision.solution ?? '',
      parameters: decision.parameters ?? [],
      rationale: decision.rationale ?? '',
      alternatives: decision.alternatives ?? [],
      tradeoffs: decision.tradeoffs ?? [],
      evidenceIds: appendEvidence(evidence, decisionEvidence),
    };
  });

  const askSamples = decisions.slice(0, 5).map((decision) => ({
    question: decision.title,
    answer: decision.solution,
    evidenceIds: decision.evidenceIds,
  }));

  const learningPath = [
    {
      id: 'ai-learning-entry',
      title: language === 'zh' ? '入口速览' : 'Entry orientation',
      duration: '15 min',
      summary: analysis.summary ?? context.description,
      relatedEntryIds: entries.slice(0, 3).map((entry) => entry.id),
      relatedDecisionIds: decisions.slice(0, 2).map((decision) => decision.id),
    },
    {
      id: 'ai-learning-decisions',
      title: language === 'zh' ? '工程取舍阅读' : 'Engineering decision read',
      duration: '45 min',
      summary: analysis.summary ?? context.description,
      relatedEntryIds: entries.slice(0, 2).map((entry) => entry.id),
      relatedDecisionIds: decisions.slice(2, 5).map((decision) => decision.id),
    },
  ];

  return {
    name: analysis.name ?? context.name,
    repository: `github.com/${context.owner}/${context.name}`,
    commit: context.commit,
    summary: analysis.summary ?? context.description,
    analysisMode: 'ai',
    techStack: analysis.techStack ?? [],
    coreModules: analysis.coreModules ?? [],
    importantFiles: analysis.importantFiles ?? context.selectedFiles.map((file) => file.path),
    complexity: [
      {
        label: language === 'zh' ? '入选文件' : 'Selected files',
        value: String(context.selectedFiles.length),
        detail: language === 'zh' ? '发送给模型参与分析的文件。' : 'Files sent to the model for analysis.',
      },
      {
        label: language === 'zh' ? '入口数量' : 'Entries',
        value: String(entries.length),
        detail: language === 'zh' ? '模型提取的用户和系统入口。' : 'User and system entry points extracted by the model.',
      },
      {
        label: language === 'zh' ? '链路数量' : 'Flows',
        value: String(flows.length),
        detail: language === 'zh' ? '模型提取的链式逻辑。' : 'Triggered chains of logic extracted by the model.',
      },
      {
        label: language === 'zh' ? '证据数量' : 'Evidence',
        value: String(evidence.length),
        detail: language === 'zh' ? '从仓库文件生成的源码引用。' : 'Source references generated from repository files.',
      },
    ],
    entries,
    flows,
    decisions,
    evidence,
    askSamples,
    learningPath,
  };
}

export async function analyzeRepository({
  repoUrl,
  provider,
  apiKey,
  model,
  endpoint,
  language,
  onProgress,
}: AnalyzeOptions): Promise<Project> {
  if (provider === 'mock') {
    onProgress?.({
      progress: 90,
      stage: language === 'zh' ? '生成示例分析' : 'Generating sample analysis',
    });
    return sampleProject;
  }

  const context = await fetchRepositoryContext(repoUrl, language, onProgress);
  onProgress?.({
    progress: 70,
    stage: language === 'zh' ? '调用模型分析仓库' : 'Calling model to analyze repository',
  });
  const prompt = buildPrompt(context, language);
  let responseText = await callAI({ provider, apiKey, model, prompt, endpoint, jsonMode: true });
  onProgress?.({
    progress: 85,
    stage: language === 'zh' ? '解析结构化结果' : 'Parsing structured result',
  });
  let analysis: SimplifiedAnalysis | null = null;
  let partiallyStructuredCandidate: SimplifiedAnalysis | null = null;
  let lastError = 'AI response could not be parsed';

  for (let attempt = 0; attempt <= 2 && analysis === null; attempt += 1) {
    try {
      const candidate = parseAIResponse(responseText);
      if (looksLikeTemplateEcho(candidate)) {
        lastError = 'AI response echoed the schema template without real repository data';
      } else {
        partiallyStructuredCandidate = candidate;
        if (isSubstantiveAnalysis(candidate)) {
          analysis = candidate;
          break;
        }
        lastError = 'AI response contains only metadata and is missing entries, flows, or decisions';
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'AI response could not be parsed';
    }

    if (analysis !== null) break;
    if (attempt >= 2) break;

    console.warn(
      `[repolens] AI response unusable: ${lastError} ` +
      `(responseLength=${responseText.length}, preview=${responseText.slice(0, 240).replace(/\n/g, ' ')}); retrying with repair prompt`,
    );
    onProgress?.({
      progress: 86 + attempt * 2,
      stage: language === 'zh' ? `修复 AI 输出格式并重试 (${attempt + 1}/2)` : `Repairing AI output and retrying (${attempt + 1}/2)`,
    });
    const repairPrompt = buildRepairPrompt(responseText, context, language, lastError);
    responseText = await callAI({ provider, apiKey, model, prompt: repairPrompt, endpoint, jsonMode: true });
  }

  if (!analysis && partiallyStructuredCandidate) {
    console.warn(
      `[repolens] AI output had no structured sections (${lastError}); hydrating entry/flow sections from static analysis`,
    );
    analysis = partiallyStructuredCandidate;
  }

  if (!analysis) {
    console.warn(
      `[repolens] AI analysis unusable after retries (${lastError}); falling back to static repository analysis`,
    );
    onProgress?.({
      progress: 95,
      stage: language === 'zh' ? '使用静态分析兜底' : 'Falling back to static analysis',
    });
    const fallbackProject = toProject(
      { name: context.name, summary: context.description },
      context,
      language,
    );
    fallbackProject.analysisMode = 'static';
    return fallbackProject;
  }
  onProgress?.({
    progress: 95,
    stage: language === 'zh' ? '生成项目学习地图' : 'Building project learning map',
  });
  return toProject(analysis, context, language);
}
