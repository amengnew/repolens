import { Check, Clock, Route } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface LearningPathPanelProps {
  project: Project;
  completedStepIds: string[];
  onToggleStep: (stepId: string) => void;
  selectedStepId: string;
  onSelectStep: (stepId: string) => void;
}

export function LearningPathPanel({
  project,
  completedStepIds,
  onToggleStep,
  selectedStepId,
  onSelectStep,
}: LearningPathPanelProps) {
  const { t } = useI18n();
  const completedCount = project.learningPath.filter((step) => completedStepIds.includes(step.id)).length;
  const progressPercent = Math.round((completedCount / project.learningPath.length) * 100);

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('learningPath')}</h1>
          <p className="section-subtitle">
            Move from a quick orientation to a contribution-ready understanding of the repository.
          </p>
        </div>
      </div>

      <div className="progress-bar" aria-label={`${t('progressLabel')}: ${progressPercent}%`}>
        <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="path-list">
        {project.learningPath.map((step) => {
          const isCompleted = completedStepIds.includes(step.id);
          return (
            <article
              className={`path-item ${isCompleted ? 'completed' : ''}`}
              key={step.id}
              style={selectedStepId === step.id ? { borderColor: 'var(--accent)' } : undefined}
            >
              <button
                type="button"
                className="path-check"
                onClick={() => onToggleStep(step.id)}
                aria-label={isCompleted ? `${t('markIncomplete')}: ${step.title}` : `${t('markComplete')}: ${step.title}`}
              >
                {isCompleted ? <Check size={16} /> : <Route size={15} />}
              </button>
              <div>
                <div className="path-header">
                  <button
                    type="button"
                    className="path-title"
                    style={{
                      padding: 0,
                      border: 0,
                      background: 'transparent',
                      textAlign: 'left',
                    }}
                    onClick={() => onSelectStep(step.id)}
                  >
                    {step.title}
                  </button>
                  <span className="path-duration">
                    <Clock size={12} /> {step.duration}
                  </span>
                </div>
                <p className="path-summary">{step.summary}</p>
                <div className="tag-row">
                  {step.relatedEntryIds.map((entryId) => {
                    const entry = project.entries.find((item) => item.id === entryId);
                    return entry ? <span className="tag" key={entry.id}>{entry.name}</span> : null;
                  })}
                  {step.relatedDecisionIds.map((decisionId) => {
                    const decision = project.decisions.find((item) => item.id === decisionId);
                    return decision ? <span className="tag" key={decision.id}>{decision.title}</span> : null;
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
