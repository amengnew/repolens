import { useEffect, useState } from 'react';
import { Clock, Database, GitBranch, RefreshCw } from 'lucide-react';
import {
  getRepositoryHistory,
  type RepositoryHistoryItem,
} from '../ai/client';
import { useI18n } from '../i18n';

interface RepositoryHistoryPanelProps {
  onLoadProject: (jobId: string) => Promise<void>;
}

export function RepositoryHistoryPanel({ onLoadProject }: RepositoryHistoryPanelProps) {
  const { t, language } = useI18n();
  const [repositories, setRepositories] = useState<RepositoryHistoryItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    getRepositoryHistory()
      .then((items) => {
        if (!cancelled) setRepositories(items);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setRepositories([]);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load repositories');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('globalRepositoryHistory')}</h1>
          <p className="section-subtitle">{t('repositoryHistorySubtitle')}</p>
        </div>
      </div>

      {repositories === null && (
        <div className="empty-evidence">
          <RefreshCw size={16} />
          {t('loadingHistory')}
        </div>
      )}

      {repositories !== null && error && <div className="empty-evidence">{error}</div>}

      {repositories !== null && !error && repositories.length === 0 && (
        <div className="empty-evidence">{t('emptyHistory')}</div>
      )}

      {repositories !== null && repositories.length > 0 && (
        <div className="path-list">
          {repositories.map((repository) => (
            <article className="path-item" key={repository.repository}>
              <button
                type="button"
                className="path-check"
                onClick={() => {
                  onLoadProject(repository.latestJobId).catch((loadError) => {
                    setError(loadError instanceof Error ? loadError.message : 'Failed to load repository');
                  });
                }}
                aria-label={t('openRepository')}
              >
                <Database size={15} />
              </button>
              <div>
                <div className="path-header">
                  <h2 className="path-title">{repository.name}</h2>
                  <span className="path-duration">
                    <Clock size={12} />
                    {formatDate(repository.latestCompletedAt)}
                  </span>
                </div>
                <p className="path-summary">
                  <GitBranch size={12} />
                  {repository.repository}
                  {repository.latestCommit ? ` · ${repository.latestCommit.slice(0, 7)}` : ''}
                </p>
                <p className="path-summary">{repository.summary}</p>
                <div className="tag-row">
                  <span className="tag">{t('analysisCount')}: {repository.analysisCount}</span>
                  {repository.providers.map((provider) => (
                    <span className="tag" key={provider}>{provider}</span>
                  ))}
                  {repository.models.slice(0, 3).map((model) => (
                    <span className="tag" key={model}>{model}</span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
