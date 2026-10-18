import type { Evidence, Project } from '../types.ts';

export function evidenceSourceUrl(
  project: Pick<Project, 'repository' | 'commit'>,
  evidence: Pick<Evidence, 'file' | 'startLine' | 'endLine'>,
) {
  const match = project.repository.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return '';

  const [, owner, repoName] = match;
  const commit = project.commit ? encodeURIComponent(project.commit) : 'main';
  const file = encodeURI(evidence.file);
  const hasLines = evidence.startLine > 0 && evidence.endLine >= evidence.startLine;
  if (!hasLines) return `https://github.com/${owner}/${repoName}/blob/${commit}/${file}`;

  const line = evidence.startLine === evidence.endLine
    ? `L${evidence.startLine}`
    : `L${evidence.startLine}-L${evidence.endLine}`;
  return `https://github.com/${owner}/${repoName}/blob/${commit}/${file}#${line}`;
}
