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
  downloadError?: string;
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

const SOURCE_FILE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rs', '.rb', '.php', '.kt', '.cs',
];
const MANIFEST_FILE_NAMES = new Set([
  'package.json',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
]);
const IGNORED_FILE_PATTERNS = [
  /(^|\/)(node_modules|vendor|dist|build|coverage|out|generated|__pycache__|\.next|\.nuxt|\.git)\//i,
  /README\.i18n\./i,
  /\.i18n\.(?:ya?ml|json)$/i,
  /(^|\/)snapshots?\//i,
  /(^|\/)benchmarks?\//i,
  /(^|\/)examples?\/(?:example|sample|demo)/i,
  /(^|\/)(?:website|docs|documentation|guide)\//i,
  /\.vitepress\//i,
  /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json|uv\.lock|poetry\.lock|Cargo\.lock)$/i,
  /\.(?:map|min\.(?:js|css)|snap|d\.ts)$/i,
];
const ENTRY_BASENAMES = new Set([
  'bin', 'cli', 'args', 'main', 'index', 'entry', 'app', 'server', 'runner', 'run',
]);
const ENTRY_SEGMENTS = new Set([
  'commands', 'command', 'handlers', 'controllers', 'routes', 'api', 'runner', 'harness',
  'plugins', 'plugin', 'tools', 'agents', 'workers', 'jobs', 'queue', 'scheduler', 'webhook',
]);
const DECISION_SEGMENTS = new Set([
  'config', 'context', 'prompt', 'compression', 'token', 'retry', 'backoff', 'timeout',
  'bundle', 'patch', 'middleware', 'auth', 'security', 'store', 'database', 'schema',
  'cache', 'provider', 'service',
]);

function isIgnoredPath(path: string) {
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function pathBasename(path: string) {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

function pathTopDirectory(path: string) {
  const parts = path.split('/');
  return parts.length > 1 ? parts[0] : '';
}

function extensionOf(path: string) {
  const basename = pathBasename(path);
  const index = basename.lastIndexOf('.');
  return index >= 0 ? basename.slice(index).toLowerCase() : '';
}

function isManifestPath(path: string) {
  return MANIFEST_FILE_NAMES.has(pathBasename(path));
}

function isDocumentationPath(path: string) {
  return extensionOf(path) === '.md' && /readme|docs?|guide|tutorial/i.test(path);
}

function isTestPath(path: string) {
  return /(^|\/)(?:test|tests|spec|specs|__tests__|fixtures?|mocks?)\//i.test(path)
    || /[._-](?:test|spec|fixture|mock)\.(?:ts|tsx|js|jsx|py|go|java|rs)$/i.test(path);
}

function languageOfExtension(extension: string) {
  if (extension === '.ts' || extension === '.tsx') return 'ts';
  if (extension === '.js' || extension === '.jsx') return 'js';
  if (extension === '.py') return 'py';
  if (extension === '.go') return 'go';
  if (extension === '.rs') return 'rs';
  if (extension === '.java') return 'java';
  return 'other';
}

function detectProjectLanguages(paths: string[]) {
  const languages = new Set<string>();
  const basenames = new Set(paths.map(pathBasename));
  if (basenames.has('package.json')) {
    languages.add('ts');
    languages.add('js');
  }
  if (basenames.has('pyproject.toml') || basenames.has('setup.py') || basenames.has('requirements.txt')) {
    languages.add('py');
  }
  if (basenames.has('go.mod')) languages.add('go');
  if (basenames.has('Cargo.toml')) languages.add('rs');
  if (basenames.has('pom.xml') || basenames.has('build.gradle')) languages.add('java');
  return languages;
}

function scoreRepositoryPath(path: string, languages: Set<string>) {
  const basename = pathBasename(path);
  const extension = extensionOf(path);
  const parts = path.toLowerCase().split('/');
  let score = 0;

  if (isIgnoredPath(path) || isTestPath(path)) return -1000;
  if (basename.toLowerCase() === 'readme.md') {
    score += parts.length === 1 ? 95 : 40;
  } else if (extension === '.md') {
    score += 20;
  }

  if (isManifestPath(path)) {
    score += parts.length === 1 ? 110 : 58;
    if (parts.includes('website')) score -= 40;
  } else if (SOURCE_FILE_EXTENSIONS.includes(extension)) {
    const language = languageOfExtension(extension);
    score += languages.size === 0 || languages.has(language) ? 32 : 10;
    if (parts.includes('website') || parts.includes('docs')) score -= 55;
    if (parts.includes('api') || parts.includes('gateway')) score += 10;
    if (parts.includes('sdk')) score += 8;
    if (parts.includes('python')) score -= 4;
    const nameWithoutExtension = basename.replace(new RegExp(`${extension.replace('.', '\\.')}$`), '');
    if (ENTRY_BASENAMES.has(nameWithoutExtension.toLowerCase())) score += 70;
    let entryMatches = 0;
    let decisionMatches = 0;
    for (const part of parts) {
      if (ENTRY_SEGMENTS.has(part)) entryMatches += 1;
      if (DECISION_SEGMENTS.has(part)) decisionMatches += 1;
    }
    score += Math.min(2, entryMatches) * 22;
    score += Math.min(2, decisionMatches) * 12;
    if (parts.includes('src')) score += 12;
  } else if (extension === '.json') {
    score -= basename === 'package.json' ? 0 : 15;
  } else if (extension === '.yaml' || extension === '.yml') {
    score -= /config|example|template|schema/i.test(path) ? 0 : 25;
  }

  if (parts.includes('docs')) score -= 10;
  return score;
}

export function selectRepositoryPaths(paths: string[], maxFiles = 14): string[] {
  const languages = detectProjectLanguages(paths);
  const candidates = paths
    .filter((path) => {
      const extension = extensionOf(path);
      return SOURCE_FILE_EXTENSIONS.includes(extension)
        || extension === '.md'
        || isManifestPath(path)
        || extension === '.json'
        || extension === '.yaml'
        || extension === '.yml';
    })
    .map((path) => ({ path, score: scoreRepositoryPath(path, languages) }))
    .filter((item) => item.score > -500)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);

  const topDirectories = new Set(candidates.map((item) => pathTopDirectory(item.path)).filter(Boolean));
  const perDirectoryCap = Math.max(2, Math.floor(maxFiles / Math.max(1, topDirectories.size)));
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const directoryCounts = new Map<string, number>();
  const strongEntryCounts = new Map<string, number>();
  let documentationCount = 0;
  let manifestCount = 0;

  for (const { path } of candidates) {
    if (selected.length >= maxFiles) break;
    const directory = pathTopDirectory(path);
    const basename = pathBasename(path).toLowerCase();
    const extension = extensionOf(path);
    const isStrongEntry = SOURCE_FILE_EXTENSIONS.includes(extension)
      && ENTRY_BASENAMES.has(basename.replace(new RegExp(`${extension.replace('.', '\\.')}$`), ''));
    if (isStrongEntry) {
      if ((strongEntryCounts.get(directory) ?? 0) >= 3) continue;
    } else if ((directoryCounts.get(directory) ?? 0) >= perDirectoryCap) {
      continue;
    }
    if (isDocumentationPath(path)) {
      if (documentationCount >= 2) continue;
      documentationCount += 1;
    }
    if (isManifestPath(path)) {
      if (manifestCount >= 3) continue;
      manifestCount += 1;
    }
    selected.push(path);
    selectedSet.add(path);
    directoryCounts.set(directory, (directoryCounts.get(directory) ?? 0) + 1);
    if (isStrongEntry) {
      strongEntryCounts.set(directory, (strongEntryCounts.get(directory) ?? 0) + 1);
    }
  }

  if (selected.length < maxFiles) {
    for (const { path } of candidates) {
      if (selected.length >= maxFiles) break;
      if (selectedSet.has(path)) continue;
      if (isDocumentationPath(path)) {
        if (documentationCount >= 2) continue;
        documentationCount += 1;
      }
      if (isManifestPath(path)) {
        if (manifestCount >= 3) continue;
        manifestCount += 1;
      }
      selected.push(path);
      selectedSet.add(path);
    }
  }

  return selected;
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
  return githubFetchWithRetry(
    url,
    githubHeaders(),
    90_000,
    4,
    (text) => {
      if (!text.trim()) {
        throw new Error('GitHub returned an empty response');
      }
      return JSON.parse(text);
    },
  );
}

async function githubFetchText(url: string): Promise<string> {
  return githubFetchWithRetry(
    url,
    { Connection: 'close', 'User-Agent': 'repolens-analysis' },
    45_000,
    5,
    (text) => text,
  );
}

async function githubFetchWithRetry<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  attempts: number,
  parse: (text: string) => T,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
          throw new Error(`GitHub request failed: ${response.status}`);
        }
        const text = await response.text();
        return parse(text);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new Error(`GitHub request timed out after ${timeoutMs}ms: ${url}`);
  }
  throw lastError instanceof Error ? lastError : new Error('GitHub request failed');
}

async function githubFetchContents(owner: string, repo: string, commit: string, path: string): Promise<string> {
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return githubFetchWithRetry(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${commit}`,
    githubHeaders('application/vnd.github.raw+json'),
    45_000,
    3,
    (text) => text,
  );
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

  const selectedPaths = selectRepositoryPaths(paths, 14);

  onProgress?.({
    progress: 55,
    stage: language === 'zh' ? '下载关键源码文件' : 'Downloading key source files',
  });
  const files = await downloadRepositoryFiles(
    selectedPaths.map((path) => `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${path}`),
    selectedPaths,
  );

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

async function downloadRepositoryFiles(
  urls: string[],
  paths: string[],
  concurrency = 4,
): Promise<RepositoryFile[]> {
  const results: RepositoryFile[] = new Array(paths.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= urls.length) return;
      try {
        const contentsUrl = urls[index];
        const match = contentsUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]+)\/(.+)$/);
        let content: string;
        if (match) {
          const [, owner, repo, commit, filePath] = match;
          content = await githubFetchContents(owner, repo, commit, filePath).catch(async () => githubFetchText(contentsUrl));
        } else {
          content = await githubFetchText(contentsUrl);
        }
        results[index] = {
          path: paths[index],
          content: content.slice(0, 14_000),
          ...(content.trim().length === 0
            ? { downloadError: 'downloaded empty content after retries' }
            : {}),
        };
      } catch (error) {
        results[index] = {
          path: paths[index],
          content: '',
          downloadError: error instanceof Error ? error.message : 'download failed',
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
  return results;
}

function buildPrompt(context: RepositoryContext, language: Language) {
  const failedDownloads = context.selectedFiles.filter((file) => file.downloadError);
  return `You are analyzing the GitHub repository ${context.name}.

Repository description: ${context.description}

The full repository tree contains ${context.paths.length} files. Only the selected files below were fetched. README files are background information only; real implementation files are the primary evidence source.
${failedDownloads.length > 0 ? `${failedDownloads.length} selected files could not be downloaded: ${failedDownloads.map((file) => file.path).join(', ')}. Treat them as unavailable; do not claim they are empty or trivial.` : ''}

Selected file catalog:
${context.selectedFiles.map((file, index) => `\n${index + 1}. ${file.path}${file.path.toLowerCase().endsWith('.md') ? ' (documentation)' : ' (code)'}`).join('')}

Selected files:
${context.selectedFiles.map((file) => `\n--- ${file.path} ---\n${file.content.slice(0, 8000)}`).join('\n')}

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
Do not use chain-of-thought reasoning or planning notes. Do not include commentary, "I will", draft JSON, or partial objects. The only text in your response must be the single final JSON object itself, beginning with { and ending with }. Keep the JSON compact: at most 10 entries, 8 flows, and 5 decisions, and sourceQuote at most 2 consecutive lines.
Use the static analysis result as high-confidence grounding for routes, commands, event handlers, and jobs. Only include entries that are real user- or system-facing entry points; do not enumerate every package.json script (for example every build/test/release script) unless that script is the repository's primary interface. Prefer CLI parsers/runners, HTTP handlers, event listeners, and jobs over helper scripts.
The role field must be one of: "End user", "Admin", "Developer", "System", "External service".
Evidence priority: entries, flows, and decisions must cite a real implementation file when one backs the claim. Never use README.i18n.yaml or a README as an implementation source. For CLI projects, cite the file that defines the command parser, argument schema, or runner (for example bin.ts, args.ts, cli.ts, commands.ts, main.py) rather than the command's documentation.
sourceQuote must be one or more complete consecutive lines copied byte-for-byte from the file named by sourcePath. Keep it to at most 2 lines and include identifiers, string literals, and punctuation exactly as they appear. If you cannot copy an exact quote from a real implementation file, omit sourcePath and sourceQuote entirely instead of quoting documentation or inventing text.
Flows should follow the actual chain where the selected code supports it: entry -> validation/argument parsing -> service/agent logic -> provider/tool/persistence -> response, and visible async or error branches. Use concrete language from the code, for example "parse --max-quota", "call provider.chat", "write to queue", rather than generic placeholders.
Decisions should describe concrete engineering trade-offs visible in the selected code: data structures, context/token budgets, compression thresholds, batching sizes, retries, timeouts, backoff values, error handling, concurrency, or security boundaries. Include the actual numbers or constants when they appear in code.
Every decision MUST have a non-empty rationale that answers WHY this implementation was chosen: name the constraint, failure mode, or cost that made the choice necessary. Do not restate the solution and do not leave rationale empty.
Return all user-facing text in ${language === 'zh' ? 'Simplified Chinese' : 'English'}.
Do not include Markdown fences.
Your final answer must start with { and end with }. Missing fields use empty arrays or empty strings. Do not explain what you are doing.`;
}

function buildCompactContext(context: RepositoryContext) {
  const failedDownloads = context.selectedFiles.filter((file) => file.downloadError);
  return `Repository: ${context.name}
Description: ${context.description}
Commit: ${context.commit}
${failedDownloads.length > 0 ? `Unavailable source files (download failed): ${failedDownloads.map((file) => file.path).join(', ')}\n` : ''}
Fetched files are shown below; large files were truncated to their first 5000 characters, so examine the shown excerpt instead of assuming the whole file is absent.

Selected source files:
${context.selectedFiles.map((file) => `\n--- ${file.path} ---\n${file.content.slice(0, 5000)}`).join('\n')}

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

Repair it into exactly one valid JSON object with this shape. Do not use chain-of-thought reasoning and do not write planning notes or draft JSON; the only text in your response must be the single final JSON object. If the previous response was truncated or partial, produce a shorter complete JSON with at most 8 entries, 6 flows, and 4 decisions, and keep sourceQuote to at most 2 consecutive lines.
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
${previousSection ? 'Keep every valid part of the previous response that describes the repository, but replace any sourcePath or sourceQuote that points at a README or i18n file with a real implementation file and an exact quote from it when the selected code supports the claim. ' : ''}Preserve and complete the decisions array: if the previous response already contained useful engineering decisions, keep them; ensure each decision has a concrete problem, solution, parameters with real constants, rationale, alternatives, and tradeoffs. rationale must be a non-empty sentence explaining WHY this choice was made: name the constraint, failure mode, or cost behind it, and never restate the solution. Do not echo your instructions, the schema, or any example. Write one complete JSON object about ${context.name} with real entry, flow, and decision data. Return all user-facing text in ${language === 'zh' ? 'Simplified Chinese' : 'English'}. Your final answer must contain only valid JSON.`;
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
  if (
    !normalizeOptionalString(record.name) &&
    !normalizeOptionalString(record.summary) &&
    !Array.isArray(record.entries) &&
    !Array.isArray(record.flows) &&
    !Array.isArray(record.decisions)
  ) {
    throw new Error('AI response JSON does not contain repository analysis fields');
  }
  if (
    !Array.isArray(record.entries) &&
    !Array.isArray(record.flows) &&
    !Array.isArray(record.decisions) &&
    (typeof record.id === 'string' || typeof record.sourcePath === 'string')
  ) {
    throw new Error('AI response is a partial nested JSON object; the full object was truncated');
  }
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

function sourceLineQuote(context: RepositoryContext, path: string, line: number): string | undefined {
  const file = context.selectedFiles.find((item) => item.path === path);
  const contentLine = file?.content.split(/\r?\n/)[Math.max(0, line - 1)]?.trim();
  return contentLine || undefined;
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
        ? `由 ${route.file}:${route.line} 中的 ${route.framework} 路由处理`
        : `Handled by a ${route.framework} route in ${route.file}:${route.line}`,
      steps: [
        language === 'zh' ? `接收 ${route.method} ${route.path} 请求` : `Receive ${route.method} ${route.path} request`,
        language === 'zh' ? `调度到 ${route.file} 中的处理器` : `Dispatch to the handler in ${route.file}`,
        language === 'zh' ? '执行业务逻辑' : 'Execute business logic',
        language === 'zh' ? '返回响应' : 'Return response',
      ],
      errorPaths: [],
      sourcePath: route.file,
      sourceQuote: sourceLineQuote(context, route.file, route.line),
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
      sourceQuote: sourceLineQuote(context, route.file, route.line),
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
        ? `由 ${command.file}:${command.line} 定义（${command.source}）`
        : `Defined in ${command.file}:${command.line} (${command.source})`,
      steps: [
        language === 'zh' ? `调用 ${command.name}` : `Invoke ${command.name}`,
        language === 'zh' ? `解析 ${command.file} 中的参数` : `Parse arguments in ${command.file}`,
        language === 'zh' ? '执行命令逻辑' : 'Execute command logic',
      ],
      errorPaths: [],
      sourcePath: command.file,
      sourceQuote: sourceLineQuote(context, command.file, command.line),
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
      sourceQuote: sourceLineQuote(context, command.file, command.line),
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
        ? `监听器位于 ${handler.file}:${handler.line}`
        : `Listener defined in ${handler.file}:${handler.line}`,
      steps: [
        language === 'zh' ? `监听 ${handler.event} 事件` : `Listen for ${handler.event}`,
        language === 'zh' ? `执行 ${handler.file} 中的回调` : `Run the callback in ${handler.file}`,
      ],
      errorPaths: [],
      sourcePath: handler.file,
      sourceQuote: sourceLineQuote(context, handler.file, handler.line),
    });
    entries.push({
      id: `static-entry-${entries.length + 1}`,
      name: language === 'zh' ? `事件 ${handler.event}` : `Event ${handler.event}`,
      role: 'System',
      kind: 'event',
      input: handler.event,
      auth: '',
      permissions: [],
      flowId,
      sourcePath: handler.file,
      sourceQuote: sourceLineQuote(context, handler.file, handler.line),
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
        ? `任务定义位于 ${job.file}:${job.line}`
        : `Job defined in ${job.file}:${job.line}`,
      steps: [
        language === 'zh' ? `启动 ${job.name} 任务` : `Start the ${job.name} job`,
        language === 'zh' ? `执行 ${job.file} 中的处理逻辑` : `Run the processing logic in ${job.file}`,
      ],
      errorPaths: [],
      sourcePath: job.file,
      sourceQuote: sourceLineQuote(context, job.file, job.line),
    });
    entries.push({
      id: `static-entry-${entries.length + 1}`,
      name: language === 'zh' ? `定时任务 ${job.name}` : `Job ${job.name}`,
      role: 'System',
      kind: 'job',
      input: job.schedule ?? '',
      auth: '',
      permissions: [],
      flowId,
      sourcePath: job.file,
      sourceQuote: sourceLineQuote(context, job.file, job.line),
    });
  }

  return { entries, flows };
}

function normalizeEvidenceLine(line: string) {
  return line.trim().replace(/\s+/g, ' ');
}

function findEvidenceLocation(file: RepositoryFile, quote: string) {
  const lines = file.content.split(/\r?\n/);
  const normalizedLines = lines.map(normalizeEvidenceLine);
  const normalizedQuote = quote.split(/\r?\n/).map(normalizeEvidenceLine).filter(Boolean).join('\n');
  const compressedQuote = normalizedQuote.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const squashedQuote = compressedQuote.replace(/\s+/g, '').replace(/\.\.\.|…/g, '');

  for (let start = 0; start < lines.length; start += 1) {
    const windowSize = Math.min(lines.length, 12);
    for (let size = 1; size <= windowSize; size += 1) {
      const candidateLines = normalizedLines.slice(start, start + size);
      const compressedCandidate = candidateLines.join(' ').replace(/\s+/g, ' ').trim();
      if (candidateLines.join('\n') === normalizedQuote || compressedCandidate === compressedQuote) {
        return { startLine: start + 1, endLine: start + size, code: lines.slice(start, start + size).join('\n') };
      }
    }
  }

  let fuzzyMatch: { start: number; size: number } | null = null;
  for (let start = 0; start < lines.length; start += 1) {
    const windowSize = Math.min(lines.length, 12);
    for (let size = 1; size <= windowSize; size += 1) {
      const candidateLines = normalizedLines.slice(start, start + size);
      const candidate = candidateLines.join('\n');
      const compressedCandidate = candidateLines.join(' ').replace(/\s+/g, ' ').trim();
      const containsQuote = candidate.length >= 40 && candidate.includes(normalizedQuote);
      if (squashedQuote.length >= 16) {
        const squashedCandidate = compressedCandidate.replace(/\s+/g, '');
        if (containsQuote || squashedCandidate.includes(squashedQuote)) {
          if (!fuzzyMatch || size < fuzzyMatch.size) {
            fuzzyMatch = { start, size };
          }
        }
      }
    }
  }

  if (fuzzyMatch) {
    return {
      startLine: fuzzyMatch.start + 1,
      endLine: fuzzyMatch.start + fuzzyMatch.size,
      code: lines.slice(fuzzyMatch.start, fuzzyMatch.start + fuzzyMatch.size).join('\n'),
    };
  }

  return null;
}

function findSourceAnchor(file: RepositoryFile) {
  const anchors = analyzeStaticFiles([file]);
  const combined = [
    ...anchors.routes.map((item) => item.line),
    ...anchors.commands.map((item) => item.line),
    ...anchors.eventHandlers.map((item) => item.line),
    ...anchors.jobs.map((item) => item.line),
  ].filter((line) => line > 0);
  const lines = file.content.split(/\r?\n/);
  for (const line of combined) {
    const code = normalizeEvidenceLine(lines[line - 1] ?? '');
    if (code.length >= 4) {
      return { startLine: line, endLine: line, code };
    }
  }
  return null;
}

function fallbackEvidenceCode(file: RepositoryFile, sourceQuote?: string) {
  if (/\.md$/i.test(file.path) || sourceQuote) {
    return sourceQuote?.slice(0, 800) || file.content.split(/\r?\n/).slice(0, 12).join('\n');
  }
  return file.content.split(/\r?\n/).slice(0, 12).join('\n');
}

function findEvidenceFallback(options: {
  id: string;
  label: string;
  sourcePath?: string;
  sourceQuote?: string;
  file: RepositoryFile;
}) {
  const anchor = findSourceAnchor(options.file);
  if (anchor) {
    return {
      evidence: {
        id: options.id,
        label: options.label,
        file: options.file.path,
        ...anchor,
        confidence: 'source verified' as const,
      },
      index: 0,
    };
  }
  if (/\.md$/i.test(options.file.path)) {
    return {
      evidence: {
        id: options.id,
        label: options.label,
        file: options.file.path,
        startLine: 1,
        endLine: Math.min(12, options.file.content.split(/\r?\n/).length),
        code: options.file.content.split(/\r?\n/).slice(0, 12).join('\n'),
        confidence: 'doc verified' as const,
      },
      index: 0,
    };
  }
  return {
    evidence: {
      id: options.id,
      label: options.label,
      file: options.file.path,
      startLine: 1,
      endLine: 1,
      code: fallbackEvidenceCode(options.file, options.sourceQuote),
      confidence: 'uncertain' as const,
    },
    index: 0,
  };
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

  return findEvidenceFallback({ ...options, file });
}

function appendEvidence(
  evidence: Project['evidence'],
  result: { evidence: Project['evidence'][number] | null; index: number },
) {
  if (!result.evidence) return [];
  evidence.push(result.evidence);
  return [result.evidence.id];
}

export function synthesizeDecisionRationale(
  decision: {
    problem?: string;
    solution?: string;
    parameters?: Array<{ key: string; value: string }>;
  },
  language: Language,
): string {
  const problem = decision.problem?.trim();
  const solution = decision.solution?.trim();
  const firstParameter = decision.parameters?.[0];
  const parameterNote = firstParameter ? `${firstParameter.key}=${firstParameter.value}` : '';

  if (language === 'zh') {
    return `代码为规避${problem ? `“${problem}”` : '对应问题'}而选择${
      solution ? `“${solution}”` : '该实现方案'
    }；${
      parameterNote ? `${parameterNote} 等参数显式标定了边界，` : ''
    }因此实现代价和运行行为可以被读代码的人直接验证。`;
  }

  return `Code chooses ${
    solution ? `“${solution}”` : 'this implementation'
  } to avoid ${problem ? `“${problem}”` : 'the underlying failure mode'}${
    parameterNote ? `; ${parameterNote} makes the boundary explicit` : ''
  }, so the implementation cost and runtime behavior are directly verifiable from source.`;
}

export function toProject(
  analysis: SimplifiedAnalysis,
  context: RepositoryContext,
  language: Language,
  mode: 'ai' | 'static' = 'ai',
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
      rationale: decision.rationale?.trim() || synthesizeDecisionRationale(decision, language),
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
    analysisMode: mode,
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
  let responseText = await callAI({ provider, apiKey, model, prompt, endpoint, jsonMode: true, maxTokens: 32_768 });
  onProgress?.({
    progress: 85,
    stage: language === 'zh' ? '解析结构化结果' : 'Parsing structured result',
  });
  async function saveDiagnostic(reason: string) {
    try {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir('.data', { recursive: true });
      await writeFile(
        '.data/ai-debug.json',
        JSON.stringify({
          reason,
          model,
          provider,
          repository: context.name,
          commit: context.commit,
          selectedFiles: context.selectedFiles.map((file) => file.path),
          responseLength: responseText.length,
          responsePreview: responseText.slice(0, 4000),
          responseTail: responseText.slice(-1000),
          lastError,
          savedAt: new Date().toISOString(),
        }, null, 2),
        'utf8',
      );
    } catch {
      // Diagnostics are best-effort and never block analysis.
    }
  }
  let analysis: SimplifiedAnalysis | null = null;
  let partiallyStructuredCandidate: SimplifiedAnalysis | null = null;
  let usedStaticHydration = false;
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

    await saveDiagnostic(lastError);
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
    responseText = await callAI({
      provider,
      apiKey,
      model,
      prompt: repairPrompt,
      endpoint,
      jsonMode: true,
      maxTokens: 32_768,
    });
  }

  if (!analysis && partiallyStructuredCandidate) {
    usedStaticHydration = true;
    console.warn(
      `[repolens] AI output had no structured sections (${lastError}); hydrating entry/flow sections from static analysis`,
    );
    analysis = partiallyStructuredCandidate;
  }

  const analysisMode: 'ai' | 'static' = usedStaticHydration ? 'static' : 'ai';

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
      'static',
    );
    return fallbackProject;
  }
  onProgress?.({
    progress: 95,
    stage: language === 'zh' ? '生成项目学习地图' : 'Building project learning map',
  });
  return toProject(analysis, context, language, analysisMode);
}
