import { useEffect, useState } from 'react';
import { Clock, FileCode2, History, RefreshCw } from 'lucide-react';
import { getAnalysisHistory, type AnalysisHistoryItem } from '../ai/client';
import { useI18n } from '../i18n';
import type { Project } from '../types';

interface HistoryPanelProps {
  project: Project;
  onLoadProject: (jobId: string) => Promise<void>;
}

export function HistoryPanel({ project, onLoadProject }: HistoryPanelProps) {
  const { t, language } = useI18n();
  const [items, setItems] = useState<AnalysisHistoryItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    getAnalysisHistory()
      .then((historyItems) => {
        if (!cancelled) {
          setItems(historyItems.filter((item) => item.repository === project.repository));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load history');
          setItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.repository]);

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('historyTitle')}</h1>
          <p className="section-subtitle">{t('historySubtitle')}</p>
        </div>
      </div>

      {items === null && (
        <div className="empty-evidence">
          <RefreshCw size={16} />
          {t('loadingHistory')}
        </div>
      )}

      {items !== null && error && (
        <div className="empty-evidence">{error}</div>
      )}

      {items !== null && !error && items.length === 0 && (
        <div className="empty-evidence">{t('emptyHistory')}</div>
      )}

      {items !== null && items.length > 0 && (
        <div className="path-list">
          {items.map((item) => (
            <article className="path-item" key={item.jobId}>
              <button
                type="button"
                className="path-check"
                onClick={() => {
                  onLoadProject(item.jobId).catch((loadError) => {
                    setError(loadError instanceof Error ? loadError.message : 'Failed to load analysis');
                  });
                }}
                aria-label={item.repository}
              >
                <History size={15} />
              </button>
              <div>
                <div className="path-header">
                  <h2 className="path-title">{item.name}</h2>
                  <span className="path-duration">
                    <Clock size={12} />
                    {formatDate(item.completedAt)}
                  </span>
                </div>
                <p className="path-summary">
                  <FileCode2 size={12} />
                  {item.repository}
                  {item.commit ? ` · ${item.commit.slice(0, 7)}` : ''}
                </p>
                <p className="path-summary">{item.summary}</p>
                <div className="tag-row">
                  <span className="tag">{item.provider}</span>
                  <span className="tag">{item.model}</span>
                  <span className="tag">{item.language === 'zh' ? '中文' : 'English'}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
