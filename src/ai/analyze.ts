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
  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!repoResponse.ok) throw new Error(`GitHub repository request failed: ${repoResponse.status}`);
  const repoData = await repoResponse.json();
  onProgress?.({
    progress: 25,
    stage: language === 'zh' ? '固定 commit' : 'Pinning commit',
  });
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${repoData.default_branch}`,
  );
  if (!commitResponse.ok) {
    throw new Error(`GitHub commit request failed: ${commitResponse.status}`);
  }
  const commitData = await commitResponse.json();
  const commit = commitData.sha;

  onProgress?.({
    progress: 40,
    stage: language === 'zh' ? '读取文件树' : 'Reading repository tree',
  });
  const treeResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`,
  );
  if (!treeResponse.ok) throw new Error(`GitHub tree request failed: ${treeResponse.status}`);
  const treeData = await treeResponse.json();

  const paths = (treeData.tree ?? [])
    .filter((item: { type?: string }) => item.type === 'blob')
    .map((item: { path?: string }) => item.path ?? '')
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
  const selectedPaths = priorityPaths.slice(0, 16).map((item: { path: string }) => item.path);

  onProgress?.({
    progress: 55,
    stage: language === 'zh' ? '下载关键源码文件' : 'Downloading key source files',
  });
  const filePromises = selectedPaths.map(async (path: string) => {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${path}`);
    if (!response.ok) return { path, content: '' };
    const text = await response.text();
    return { path, content: text.slice(0, 8000) };
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
Do not include Markdown fences.`;
}

const validEntryKinds = ['http', 'ui', 'cli', 'event', 'job', 'tool', 'websocket'];
const validRoles = ['End user', 'Admin', 'Developer', 'System', 'External service'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringArray(record: Record<string, unknown>, key: string) {
  if (record[key] === undefined) return;
  if (!Array.isArray(record[key])) {
    throw new Error(`AI response field ${key} must be an array`);
  }
  if ((record[key] as unknown[]).some((item) => typeof item !== 'string')) {
    throw new Error(`AI response field ${key} must contain only strings`);
  }
}

function requireOptionalString(record: Record<string, unknown>, key: string) {
  if (record[key] !== undefined && typeof record[key] !== 'string') {
    throw new Error(`AI response field ${key} must be a string`);
  }
}

export function parseAIResponse(text: string): SimplifiedAnalysis {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('AI response is not an object');
  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.summary !== 'string') {
    throw new Error('AI response is missing name or summary');
  }

  for (const key of ['techStack', 'coreModules', 'importantFiles']) {
    requireStringArray(record, key);
  }

  if (record.entries !== undefined) {
    if (!Array.isArray(record.entries)) throw new Error('AI response field entries must be an array');
    for (const entry of record.entries) {
      if (!isRecord(entry)) throw new Error('Each AI response entry must be an object');
      if (typeof entry.name !== 'string' || entry.name.length === 0) {
        throw new Error('Each AI response entry requires a non-empty name');
      }
      if (!validRoles.includes(entry.role as string)) {
        throw new Error(`AI response entry role is invalid: ${String(entry.role)}`);
      }
      if (!validEntryKinds.includes(entry.kind as string)) {
        throw new Error(`AI response entry kind is invalid: ${String(entry.kind)}`);
      }
      requireOptionalString(entry, 'flowId');
      requireOptionalString(entry, 'sourcePath');
      requireOptionalString(entry, 'sourceQuote');
      requireStringArray(entry, 'permissions');
    }
  }

  if (record.flows !== undefined) {
    if (!Array.isArray(record.flows)) throw new Error('AI response field flows must be an array');
    for (const flow of record.flows) {
      if (!isRecord(flow)) throw new Error('Each AI response flow must be an object');
      if (typeof flow.name !== 'string' || flow.name.length === 0) {
        throw new Error('Each AI response flow requires a non-empty name');
      }
      if (!Array.isArray(flow.steps) || flow.steps.some((step) => typeof step !== 'string')) {
        throw new Error(`AI response flow ${String(flow.name)} requires a string array named steps`);
      }
      requireStringArray(flow, 'errorPaths');
      requireOptionalString(flow, 'sourcePath');
      requireOptionalString(flow, 'sourceQuote');
    }
  }

  if (record.decisions !== undefined) {
    if (!Array.isArray(record.decisions)) throw new Error('AI response field decisions must be an array');
    for (const decision of record.decisions) {
      if (!isRecord(decision)) throw new Error('Each AI response decision must be an object');
      for (const key of ['title', 'problem', 'solution']) {
        if (typeof decision[key] !== 'string' || (decision[key] as string).length === 0) {
          throw new Error(`Each AI response decision requires a non-empty ${key}`);
        }
      }
      if (decision.parameters !== undefined) {
        if (!Array.isArray(decision.parameters)) {
          throw new Error('AI response decision parameters must be an array');
        }
        for (const parameter of decision.parameters) {
          if (
            !isRecord(parameter) ||
            typeof parameter.key !== 'string' ||
            typeof parameter.value !== 'string'
          ) {
            throw new Error('Each AI response decision parameter requires key and value strings');
          }
        }
      }
      requireStringArray(decision, 'alternatives');
      requireStringArray(decision, 'tradeoffs');
      requireOptionalString(decision, 'sourcePath');
      requireOptionalString(decision, 'sourceQuote');
    }
  }

  return record as SimplifiedAnalysis;
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

  const flows = (analysis.flows ?? []).map((flow, flowIndex) => {
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

  const entries = (analysis.entries ?? []).map((entry, index) => {
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

  const decisions = (analysis.decisions ?? []).map((decision, index) => {
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
  const responseText = await callAI({ provider, apiKey, model, prompt });
  onProgress?.({
    progress: 85,
    stage: language === 'zh' ? '解析结构化结果' : 'Parsing structured result',
  });
  const analysis = parseAIResponse(responseText);
  onProgress?.({
    progress: 95,
    stage: language === 'zh' ? '生成项目学习地图' : 'Building project learning map',
  });
  return toProject(analysis, context, language);
}
