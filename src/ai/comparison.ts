import type { Project } from '../types.ts';

export type ComparisonStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface ComparisonChange {
  id: string;
  name: string;
  kind: 'entry' | 'flow' | 'decision';
  status: ComparisonStatus;
  baseSummary?: string;
  targetSummary?: string;
}

export interface ComparisonResult {
  base: {
    jobId: string;
    repository: string;
    commit: string;
    provider: string;
    model: string;
    language: string;
    completedAt: number;
  };
  target: {
    jobId: string;
    repository: string;
    commit: string;
    provider: string;
    model: string;
    language: string;
    completedAt: number;
  };
  changes: ComparisonChange[];
  counts: {
    entries: { base: number; target: number; added: number; removed: number; changed: number };
    flows: { base: number; target: number; added: number; removed: number; changed: number };
    decisions: { base: number; target: number; added: number; removed: number; changed: number };
    evidence: { base: number; target: number; sourceVerified: number; docVerified: number; inferred: number };
  };
}

function keyBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(key(item), item);
  }
  return map;
}

function summarizeEntry(entry: Project['entries'][number]) {
  return [
    entry.role,
    entry.kind,
    entry.input,
    entry.auth,
    entry.permissions.join(', '),
    entry.flowId,
  ].join(' | ');
}

function summarizeFlow(flow: Project['flows'][number]) {
  return [
    flow.trigger,
    flow.description,
    flow.nodes.map((node) => node.label).join(' -> '),
    flow.errorPaths.join(' | '),
  ].join(' | ');
}

function summarizeDecision(decision: Project['decisions'][number]) {
  return [
    decision.problem,
    decision.solution,
    decision.parameters.map((parameter) => `${parameter.key}=${parameter.value}`).join(', '),
    decision.rationale,
    decision.alternatives.join(', '),
    decision.tradeoffs.join(', '),
  ].join(' | ');
}

function diffSection(
  baseItems: Array<{ id: string; name: string; summary: string }>,
  targetItems: Array<{ id: string; name: string; summary: string }>,
  kind: ComparisonChange['kind'],
) {
  const baseMap = keyBy(baseItems, (item) => item.name);
  const targetMap = keyBy(targetItems, (item) => item.name);
  const changes: ComparisonChange[] = [];

  for (const [name, base] of baseMap) {
    const target = targetMap.get(name);
    if (!target) {
      changes.push({
        id: base.id,
        name,
        kind,
        status: 'removed',
        baseSummary: base.summary,
      });
      continue;
    }

    const status = base.summary === target.summary ? 'unchanged' : 'changed';
    changes.push({
      id: target.id,
      name,
      kind,
      status,
      baseSummary: base.summary,
      targetSummary: target.summary,
    });
  }

  for (const [name, target] of targetMap) {
    if (!baseMap.has(name)) {
      changes.push({
        id: target.id,
        name,
        kind,
        status: 'added',
        targetSummary: target.summary,
      });
    }
  }

  return changes;
}

function countStatuses(changes: ComparisonChange[]) {
  return {
    added: changes.filter((change) => change.status === 'added').length,
    removed: changes.filter((change) => change.status === 'removed').length,
    changed: changes.filter((change) => change.status === 'changed').length,
  };
}

export function compareProjects(
  base: Project,
  target: Project,
  metadata: {
    base: { jobId: string; provider: string; model: string; language: string; completedAt: number };
    target: { jobId: string; provider: string; model: string; language: string; completedAt: number };
  },
): ComparisonResult {
  const entryChanges = diffSection(
    base.entries.map((entry) => ({ id: entry.id, name: entry.name, summary: summarizeEntry(entry) })),
    target.entries.map((entry) => ({ id: entry.id, name: entry.name, summary: summarizeEntry(entry) })),
    'entry',
  );

  const flowChanges = diffSection(
    base.flows.map((flow) => ({ id: flow.id, name: flow.name, summary: summarizeFlow(flow) })),
    target.flows.map((flow) => ({ id: flow.id, name: flow.name, summary: summarizeFlow(flow) })),
    'flow',
  );

  const decisionChanges = diffSection(
    base.decisions.map((decision) => ({
      id: decision.id,
      name: decision.title,
      summary: summarizeDecision(decision),
    })),
    target.decisions.map((decision) => ({
      id: decision.id,
      name: decision.title,
      summary: summarizeDecision(decision),
    })),
    'decision',
  );

  const evidenceCounts = (project: Project) => ({
    sourceVerified: project.evidence.filter((item) => item.confidence === 'source verified').length,
    docVerified: project.evidence.filter((item) => item.confidence === 'doc verified').length,
    inferred: project.evidence.filter((item) => item.confidence === 'inferred').length,
  });

  return {
    base: {
      jobId: metadata.base.jobId,
      repository: base.repository,
      commit: base.commit,
      provider: metadata.base.provider,
      model: metadata.base.model,
      language: metadata.base.language,
      completedAt: metadata.base.completedAt,
    },
    target: {
      jobId: metadata.target.jobId,
      repository: target.repository,
      commit: target.commit,
      provider: metadata.target.provider,
      model: metadata.target.model,
      language: metadata.target.language,
      completedAt: metadata.target.completedAt,
    },
    changes: [...entryChanges, ...flowChanges, ...decisionChanges],
    counts: {
      entries: {
        base: base.entries.length,
        target: target.entries.length,
        ...countStatuses(entryChanges),
      },
      flows: {
        base: base.flows.length,
        target: target.flows.length,
        ...countStatuses(flowChanges),
      },
      decisions: {
        base: base.decisions.length,
        target: target.decisions.length,
        ...countStatuses(decisionChanges),
      },
      evidence: {
        base: base.evidence.length,
        target: target.evidence.length,
        ...evidenceCounts(target),
      },
    },
  };
}
