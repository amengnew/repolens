import { useState } from 'react';
import { BadgeCheck, MessageCircle, Search } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface AskPanelProps {
  project: Project;
  selectedQuestion: string;
  onSelectQuestion: (question: string) => void;
}

export function AskPanel({ project, selectedQuestion, onSelectQuestion }: AskPanelProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const filteredQuestions = project.askSamples.filter((sample) =>
    sample.question.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectedSample =
    project.askSamples.find((sample) => sample.question === selectedQuestion) ?? project.askSamples[0];

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('askThisRepo')}</h1>
          <p className="section-subtitle">
            {t('answersScoped')}
          </p>
        </div>
      </div>

      <div className="ask-layout">
        <aside className="list-panel">
          <h2 className="panel-heading">
            <Search size={15} />
            {t('questions')}
          </h2>
          <input
            type="search"
            value={query}
            placeholder={t('filterQuestions')}
            onChange={(event) => setQuery(event.target.value)}
            style={{
              width: '100%',
              marginBottom: '12px',
              padding: '10px 11px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--surface-muted)',
            }}
          />
          <div className="decision-list">
            {filteredQuestions.map((sample) => (
              <button
                type="button"
                className="question-button"
                key={sample.question}
                aria-pressed={selectedSample.question === sample.question}
                onClick={() => onSelectQuestion(sample.question)}
              >
                {sample.question}
              </button>
            ))}
          </div>
        </aside>

        <article className="answer-block">
          <h2 className="panel-heading">
            <MessageCircle size={15} />
            {t('answer')}
          </h2>
          <p className="answer-text">{selectedSample.answer}</p>
          <h3 className="panel-heading">
            <BadgeCheck size={15} />
            {t('citations')}
          </h3>
          <div className="tag-row">
            {selectedSample.evidenceIds.map((evidenceId) => {
              const evidence = project.evidence.find((item) => item.id === evidenceId);
              return evidence ? (
                <span className="tag" key={evidence.id}>
                  {evidence.file}:{evidence.startLine}-{evidence.endLine}
                </span>
              ) : null;
            })}
          </div>
        </article>
      </div>
    </div>
  );
}
