import type { Language } from '../i18n';
import type { Project } from '../types';
import { findLargestValidJsonObject } from './analyze.ts';

export interface AskResult {
  answer: string;
  evidenceIds: string[];
}

export function buildAskPrompt(project: Project, question: string, language: Language): string {
  const entries = project.entries.slice(0, 8).map((entry) => ({
    id: entry.id,
    name: entry.name,
    role: entry.role,
    kind: entry.kind,
    input: entry.input,
    auth: entry.auth,
  }));
  const flows = project.flows.slice(0, 5).map((flow) => ({
    id: flow.id,
    name: flow.name,
    trigger: flow.trigger,
    description: flow.description,
    nodes: flow.nodes.slice(0, 8).map((node) => `${node.label}: ${node.description}`),
    errorPaths: flow.errorPaths,
  }));
  const decisions = project.decisions.slice(0, 5).map((decision) => ({
    id: decision.id,
    title: decision.title,
    problem: decision.problem,
    solution: decision.solution,
    parameters: decision.parameters,
    rationale: decision.rationale,
    tradeoffs: decision.tradeoffs,
  }));
  const evidence = project.evidence.slice(0, 14).map((item) => ({
    id: item.id,
    file: item.file,
    startLine: item.startLine,
    endLine: item.endLine,
    confidence: item.confidence,
    code: item.code.slice(0, 320),
  }));

  return `You are helping a developer understand the open-source project "${project.name}" (${project.repository} at commit ${project.commit.slice(0, 12)}).

Question: ${question}

The analysis was generated from this exact commit and contains ${project.entries.length} entries, ${project.flows.length} flows, ${project.decisions.length} decisions, and ${project.evidence.length} evidence items.

Project summary: ${project.summary}
Tech stack: ${project.techStack.join(', ')}

Entries:
${JSON.stringify(entries, null, 2)}

Flows:
${JSON.stringify(flows, null, 2)}

Engineering decisions:
${JSON.stringify(decisions, null, 2)}

Evidence (id, file, lines, confidence, code excerpt):
${JSON.stringify(evidence, null, 2)}

Answer the question using only the repository data and source evidence above. Do not invent files, line numbers, or behaviors. If the evidence does not answer the question, say so explicitly.

Return exactly one JSON object with this shape:
{
  "answer": "concise answer in ${language === 'zh' ? 'Simplified Chinese' : 'English'}",
  "citations": [
    { "evidenceId": "exact evidence id from the evidence list above", "quote": "short supporting quote from that evidence" }
  ]
}

Rules:
- Every citation's evidenceId must exist in the evidence list above. Use at most 6 citations. If nothing supports the answer, return an empty citations array.
- Do not echo this schema or add any text outside the JSON object. No Markdown fences.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveCitations(payload: Record<string, unknown>, project: Project): string[] {
  const ids: string[] = [];
  const push = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };

  if (Array.isArray(payload.evidenceIds)) {
    for (const id of payload.evidenceIds) {
      if (typeof id === 'string' && project.evidence.some((item) => item.id === id)) push(id);
    }
  }

  if (!Array.isArray(payload.citations)) return ids.slice(0, 6);

  for (const citation of payload.citations) {
    if (!isRecord(citation)) continue;
    if (typeof citation.evidenceId === 'string'
      && project.evidence.some((item) => item.id === citation.evidenceId)) {
      push(citation.evidenceId);
      continue;
    }

    const file = typeof citation.file === 'string' ? citation.file : '';
    const line = typeof citation.line === 'number' ? citation.line : undefined;
    const quote = typeof citation.quote === 'string' ? citation.quote.trim() : '';
    const match = project.evidence.find((item) => {
      const fileMatches = file.length > 0 && file === item.file;
      const lineMatches = typeof line === 'number' && line >= item.startLine && line <= item.endLine;
      const quoteMatches = quote.length > 0
        && (item.code.includes(quote) || quote.includes(item.code.trim().slice(0, 40)));
      return fileMatches && (lineMatches || quoteMatches);
    });
    if (match) push(match.id);
  }

  return ids.slice(0, 6);
}

export function parseAskResponse(text: string, project: Project): AskResult | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = findLargestValidJsonObject(text);
  }

  if (!isRecord(parsed)) return null;
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  if (answer.length === 0) return null;

  return { answer, evidenceIds: resolveCitations(parsed, project) };
}

export function buildMockAskResult(project: Project, question: string): AskResult {
  const normalized = question.trim().toLowerCase();
  const match = project.askSamples.find((sample) => {
    if (!normalized) return false;
    return sample.question.toLowerCase().includes(normalized)
      || normalized.includes(sample.question.toLowerCase());
  });
  const sample = match ?? project.askSamples[0];
  return {
    answer: sample?.answer
      ?? 'This repository has been analyzed, but the available sample answers do not cover this question.',
    evidenceIds: sample?.evidenceIds ?? [],
  };
}
