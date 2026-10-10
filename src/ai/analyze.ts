import type { Project } from '../types.ts';
import type { Language } from '../i18n.tsx';
import { sampleProject } from '../data/sampleProject.ts';
import { callAI, type ProviderId } from './providers.ts';

export interface AnalyzeOptions {
  repoUrl: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
  language: Language;
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
  }>;
  flows?: Array<{
    id?: string;
    name?: string;
    trigger?: string;
    description?: string;
    steps?: string[];
    errorPaths?: string[];
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
  }>;
}

function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

async function fetchRepositoryContext(repoUrl: string) {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!repoResponse.ok) throw new Error(`GitHub repository request failed: ${repoResponse.status}`);
  const repoData = await repoResponse.json();
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${repoData.default_branch}`,
  );
  if (!commitResponse.ok) {
    throw new Error(`GitHub commit request failed: ${commitResponse.status}`);
  }
  const commitData = await commitResponse.json();
  const commit = commitData.sha;

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
  const relevantPaths = paths.filter((path: string) =>
    relevantExtensions.some((extension) => path.endsWith(extension)) &&
    !path.includes('node_modules/') &&
    !path.includes('dist/'),
  );
  const selectedPaths = relevantPaths.slice(0, 12);

  const filePromises = selectedPaths.map(async (path: string) => {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${path}`);
    if (!response.ok) return { path, content: '' };
    const text = await response.text();
    return { path, content: text.slice(0, 6000) };
  });
  const files = await Promise.all(filePromises);

  return {
    name: repoData.name ?? repo,
    description: repoData.description ?? '',
    defaultBranch: repoData.default_branch ?? 'main',
    commit,
    paths,
    selectedFiles: files,
  };
}

function buildPrompt(context: Awaited<ReturnType<typeof fetchRepositoryContext>>, language: Language) {
  return `You are analyzing the GitHub repository ${context.name}.

Repository description: ${context.description}

Selected files:
${context.selectedFiles.map((file) => `\n--- ${file.path} ---\n${file.content}`).join('\n')}

Return only valid JSON with this exact shape:
{
  "name": string,
  "summary": string,
  "techStack": string[],
  "coreModules": string[],
  "importantFiles": string[],
  "entries": [{"id":string,"name":string,"role":string,"kind":"ui"|"http"|"cli"|"event"|"job"|"tool"|"websocket","input":string,"auth":string,"permissions":string[],"flowId":string}],
  "flows": [{"id":string,"name":string,"trigger":string,"description":string,"steps":string[],"errorPaths":string[]}],
  "decisions": [{"id":string,"title":string,"topic":string,"problem":string,"solution":string,"parameters":[{"key":string,"value":string}],"rationale":string,"alternatives":string[],"tradeoffs":string[]}]
}

Focus on user-facing entry points, the chain of logic they trigger, and engineering trade-offs.
Return all user-facing text in ${language === 'zh' ? 'Simplified Chinese' : 'English'}.
Do not include Markdown fences.`;
}

function parseAIResponse(text: string): SimplifiedAnalysis {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('AI response is not an object');
  return parsed as SimplifiedAnalysis;
}

function toProject(analysis: SimplifiedAnalysis, context: Awaited<ReturnType<typeof fetchRepositoryContext>>): Project {
  const flows = (analysis.flows ?? []).map((flow, flowIndex) => {
    const steps = flow.steps ?? [];
    const nodes = steps.map((step, index) => ({
      id: `${flow.id ?? `flow-${flowIndex}`}-node-${index}`,
      label: step,
      type: 'service' as Project['flows'][number]['nodes'][number]['type'],
      description: step,
      evidenceIds: [],
      decisionIds: [],
      position: { x: index * 220, y: 160 },
    }));
    const edges = nodes.slice(0, -1).map((node, index) => ({
      id: `${flow.id ?? `flow-${flowIndex}`}-edge-${index}`,
      source: node.id,
      target: nodes[index + 1].id,
      label: 'next',
      kind: 'call' as Project['flows'][number]['edges'][number]['kind'],
    }));
    return {
      id: flow.id ?? `flow-${flowIndex}`,
      name: flow.name ?? `Flow ${flowIndex + 1}`,
      trigger: flow.trigger ?? '',
      description: flow.description ?? '',
      nodes,
      edges,
      errorPaths: flow.errorPaths ?? [],
    };
  });

  const entries = (analysis.entries ?? []).map((entry, index) => ({
    id: entry.id ?? `entry-${index}`,
    name: entry.name ?? `Entry ${index + 1}`,
    role: (entry.role as Project['entries'][number]['role']) ?? 'Developer',
    kind: (entry.kind as Project['entries'][number]['kind']) ?? 'http',
    input: entry.input ?? '',
    auth: entry.auth ?? '',
    permissions: entry.permissions ?? [],
    flowId: entry.flowId ?? flows[0]?.id ?? '',
    evidenceIds: [],
  }));

  const decisions = (analysis.decisions ?? []).map((decision, index) => ({
    id: decision.id ?? `decision-${index}`,
    title: decision.title ?? `Decision ${index + 1}`,
    topic: decision.topic ?? '',
    problem: decision.problem ?? '',
    solution: decision.solution ?? '',
    parameters: decision.parameters ?? [],
    rationale: decision.rationale ?? '',
    alternatives: decision.alternatives ?? [],
    tradeoffs: decision.tradeoffs ?? [],
    evidenceIds: [],
  }));

  return {
    ...sampleProject,
    name: analysis.name ?? context.name,
    repository: `github.com/${context.name}`,
    commit: context.commit,
    summary: analysis.summary ?? context.description,
    techStack: analysis.techStack ?? [],
    coreModules: analysis.coreModules ?? [],
    importantFiles: analysis.importantFiles ?? context.selectedFiles.map((file) => file.path),
    entries: entries.length > 0 ? entries : sampleProject.entries,
    flows: flows.length > 0 ? flows : sampleProject.flows,
    decisions: decisions.length > 0 ? decisions : sampleProject.decisions,
    evidence: sampleProject.evidence,
    askSamples: sampleProject.askSamples,
    learningPath: sampleProject.learningPath,
  };
}

export async function analyzeRepository({ repoUrl, provider, apiKey, model, language }: AnalyzeOptions): Promise<Project> {
  if (provider === 'mock') {
    return sampleProject;
  }

  const context = await fetchRepositoryContext(repoUrl);
  const prompt = buildPrompt(context, language);
  const responseText = await callAI({ provider, apiKey, model, prompt });
  const analysis = parseAIResponse(responseText);
  return toProject(analysis, context);
}
