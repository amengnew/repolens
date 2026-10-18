import { Check, GitBranch, Lightbulb, Scale, TriangleAlert } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface DecisionsPanelProps {
  project: Project;
  selectedDecisionId: string | null;
  onSelectDecision: (decisionId: string) => void;
}

export function DecisionsPanel({ project, selectedDecisionId, onSelectDecision }: DecisionsPanelProps) {
  const { t } = useI18n();
  const selectedDecision =
    project.decisions.find((decision) => decision.id === selectedDecisionId) ?? project.decisions[0];

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('engineeringDecisions')}</h1>
          <p className="section-subtitle">{t('decisionSubtitle')}</p>
        </div>
      </div>

      <div className="decision-layout">
        <aside className="decision-list">
          {project.decisions.map((decision) => (
            <button
              type="button"
              className="decision-button"
              key={decision.id}
              aria-pressed={selectedDecision.id === decision.id}
              onClick={() => onSelectDecision(decision.id)}
            >
              <span className="decision-title">{decision.title}</span>
              <span className="decision-topic">{decision.topic}</span>
            </button>
          ))}
        </aside>

        <article className="decision-detail">
          <header>
            <h2 className="section-title">{selectedDecision.title}</h2>
            <p className="section-subtitle">{selectedDecision.topic}</p>
          </header>

          <div className="detail-grid">
            <div>
              <span className="detail-label">{t('problem')}</span>
              <p className="detail-text">{selectedDecision.problem}</p>
            </div>
            <div>
              <span className="detail-label">{t('currentSolution')}</span>
              <p className="detail-text">{selectedDecision.solution}</p>
            </div>
          </div>

          <section className="panel-section">
            <h3 className="panel-heading">
              <Scale size={15} />
              {t('parameters')}
            </h3>
            <table className="parameter-table">
              <thead>
                <tr>
                  <th>{t('key')}</th>
                  <th>{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {selectedDecision.parameters.map((parameter) => (
                  <tr key={parameter.key}>
                    <td>{parameter.key}</td>
                    <td>{parameter.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel-section">
            <h3 className="panel-heading">
              <Lightbulb size={15} />
              {t('rationale')}
            </h3>
            <p className="detail-text">{selectedDecision.rationale}</p>
          </section>

          <div className="detail-grid">
            <div className="list-panel">
              <h3 className="panel-heading">
                <GitBranch size={15} />
                {t('alternatives')}
              </h3>
              <ul className="simple-list">
                {selectedDecision.alternatives.map((alternative) => (
                  <li key={alternative}>
                    <GitBranch size={13} />
                    {alternative}
                  </li>
                ))}
              </ul>
            </div>
            <div className="list-panel">
              <h3 className="panel-heading">
                <TriangleAlert size={15} />
                {t('tradeoffs')}
              </h3>
              <ul className="simple-list">
                {selectedDecision.tradeoffs.map((tradeoff) => (
                  <li key={tradeoff}>
                    <TriangleAlert size={13} />
                    {tradeoff}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <section className="panel-section">
            <h3 className="panel-heading">
              <Check size={15} />
              {t('evidence')}
            </h3>
            <div className="tag-row">
              {selectedDecision.evidenceIds.map((evidenceId) => {
                const evidence = project.evidence.find((item) => item.id === evidenceId);
                return evidence ? (
                  <span className="tag" key={evidence.id}>
                    {evidence.file}:{evidence.startLine}-{evidence.endLine}
                  </span>
                ) : null;
              })}
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}
