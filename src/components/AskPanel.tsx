import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, MessageCircle, Search, Send } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';
import { askRepository, type AskResponse } from '../ai/client';
import type { ProviderId } from '../ai/providers';

interface AskPanelProps {
  project: Project;
  provider: ProviderId;
  model: string;
  selectedQuestion: string;
  onSelectQuestion: (question: string) => void;
}

export function AskPanel({
  project,
  provider,
  model,
  selectedQuestion,
  onSelectQuestion,
}: AskPanelProps) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const [input, setInput] = useState(selectedQuestion);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [askedQuestion, setAskedQuestion] = useState('');
  const [status, setStatus] = useState<'idle' | 'asking' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setInput(selectedQuestion);
    setResult(null);
    setAskedQuestion('');
    setStatus('idle');
    setError('');
  }, [project.repository, project.commit, selectedQuestion]);

  const filteredQuestions = project.askSamples.filter((sample) =>
    sample.question.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || status === 'asking') return;
    setStatus('asking');
    setError('');
    try {
      const next = await askRepository({
        repoUrl: `https://${project.repository}`,
        provider,
        model,
        language,
        question: trimmed,
      });
      setResult(next);
      setAskedQuestion(trimmed);
      setStatus('idle');
    } catch (askError) {
      setStatus('error');
      setError(askError instanceof Error ? askError.message : t('askError'));
    }
  };

  const handlePreset = (question: string) => {
    setInput(question);
    onSelectQuestion(question);
    void ask(question);
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('askThisRepo')}</h1>
          <p className="section-subtitle">{t('answersScoped')}</p>
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
                aria-pressed={selectedQuestion === sample.question}
                onClick={() => handlePreset(sample.question)}
                disabled={status === 'asking'}
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
          <div className="ask-input-row">
            <input
              id="ask-question"
              type="text"
              className="text-input"
              value={input}
              placeholder={t('askPlaceholder')}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void ask(input);
              }}
              disabled={status === 'asking'}
            />
            <button
              type="button"
              className="filter-button"
              onClick={() => void ask(input)}
              disabled={status === 'asking' || input.trim().length === 0}
            >
              {status === 'asking' ? <Loader2 size={14} /> : <Send size={14} />}
              {status === 'asking' ? t('askLoading') : t('askSubmit')}
            </button>
          </div>

          {status === 'error' && <p className="path-summary ask-error">{error}</p>}

          {result ? (
            <>
              <p className="path-summary ask-question">Q: {askedQuestion}</p>
              <p className="answer-text">{result.answer}</p>
              <h3 className="panel-heading">
                <BadgeCheck size={15} />
                {t('citations')}
              </h3>
              {result.evidenceIds.length > 0 ? (
                <div className="tag-row">
                  {result.evidenceIds.map((evidenceId) => {
                    const evidence = project.evidence.find((item) => item.id === evidenceId);
                    return evidence ? (
                      <span className="tag" key={evidence.id}>
                        {evidence.file}:{evidence.startLine}-{evidence.endLine}
                      </span>
                    ) : null;
                  })}
                </div>
              ) : (
                <p className="path-summary">{t('askNoCitations')}</p>
              )}
            </>
          ) : status === 'asking' ? (
            <p className="path-summary">{t('askLoading')}</p>
          ) : (
            <p className="path-summary answer-placeholder">{t('answersScoped')}</p>
          )}
        </article>
      </div>
    </div>
  );
}
