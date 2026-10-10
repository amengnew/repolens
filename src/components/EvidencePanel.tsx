import { FileCode2, ShieldCheck } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface EvidencePanelProps {
  project: Project;
  title: string;
  subtitle: string;
  evidenceIds: string[];
}

export function EvidencePanel({ project, title, subtitle, evidenceIds }: EvidencePanelProps) {
  const { t } = useI18n();
  const evidenceItems = evidenceIds
    .map((id) => project.evidence.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <aside className="evidence-panel">
      <div className="evidence-header">
        <div>
          <h2 className="evidence-title">{title}</h2>
          <p className="evidence-subtitle">{subtitle}</p>
        </div>
        {evidenceItems.length > 0 && (
          <span className={`confidence-badge ${evidenceItems[0].confidence === 'inferred' ? 'inferred' : ''}`}>
            <ShieldCheck size={12} />
            {evidenceItems[0].confidence}
          </span>
        )}
      </div>

      {evidenceItems.length === 0 ? (
        <div className="empty-evidence">{t('selectEvidence')}</div>
      ) : (
        <div className="evidence-list">
          {evidenceItems.map((evidence) => (
            <article className="evidence-card" key={evidence.id}>
              <span className="evidence-label">{evidence.label}</span>
              <p className="evidence-file">
                <FileCode2 size={12} />
                {evidence.file}:{evidence.startLine}-{evidence.endLine}
              </p>
              <pre className="code-block">{evidence.code}</pre>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
