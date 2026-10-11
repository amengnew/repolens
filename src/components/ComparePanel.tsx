import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitCompare, Loader2, RefreshCw } from 'lucide-react';
import {
  compareAnalyses,
  getAnalysisHistory,
  type AnalysisHistoryItem,
} from '../ai/client';
import type { ComparisonResult } from '../ai/comparison';
import { useI18n } from '../i18n';

export function ComparePanel() {
  const { t, language } = useI18n();
  const [history, setHistory] = useState<AnalysisHistoryItem[] | null>(null);
  const [baseJobId, setBaseJobId] = useState('');
  const [targetJobId, setTargetJobId] = useState('');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    getAnalysisHistory()
      .then((items) => {
        if (cancelled) return;
        setHistory(items);
        setBaseJobId(items[0]?.jobId ?? '');
        setTargetJobId(items[1]?.jobId ?? items[0]?.jobId ?? '');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load history');
        setHistory([]);
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

  const entryChanges = useMemo(
    () => result?.changes.filter((change) => change.kind === 'entry' && change.status !== 'unchanged') ?? [],
    [result],
  );
  const flowChanges = useMemo(
    () => result?.changes.filter((change) => change.kind === 'flow' && change.status !== 'unchanged') ?? [],
    [result],
  );
  const decisionChanges = useMemo(
    () => result?.changes.filter((change) => change.kind === 'decision' && change.status !== 'unchanged') ?? [],
    [result],
  );

  const handleCompare = async () => {
    if (!baseJobId || !targetJobId || baseJobId === targetJobId) return;

    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await compareAnalyses(baseJobId, targetJobId));
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  const optionLabel = (item: AnalysisHistoryItem) =>
    `${item.repository} · ${item.commit.slice(0, 7)} · ${item.provider}`;

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('compareTitle')}</h1>
          <p className="section-subtitle">{t('compareSubtitle')}</p>
        </div>
      </div>

      {history === null && (
        <div className="empty-evidence">
          <RefreshCw size={16} />
          {t('loadingHistory')}
        </div>
      )}

      {history !== null && history.length < 2 && (
        <div className="empty-evidence">{t('emptyHistory')}</div>
      )}

      {history !== null && history.length >= 2 && (
        <>
          <section className="panel-section two-column">
            <div className="list-panel">
              <h2 className="panel-heading">{t('baseAnalysis')}</h2>
              <select
                value={baseJobId}
                onChange={(event) => setBaseJobId(event.target.value)}
                className="compare-select"
              >
                {history.map((item) => (
                  <option key={item.jobId} value={item.jobId}>
                    {optionLabel(item)}
                  </option>
                ))}
              </select>
            </div>
            <div className="list-panel">
              <h2 className="panel-heading">{t('targetAnalysis')}</h2>
              <select
                value={targetJobId}
                onChange={(event) => setTargetJobId(event.target.value)}
                className="compare-select"
              >
                {history.map((item) => (
                  <option key={item.jobId} value={item.jobId}>
                    {optionLabel(item)}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="panel-section">
            <button
              type="button"
              className="filter-button"
              onClick={handleCompare}
              disabled={loading || !baseJobId || !targetJobId || baseJobId === targetJobId}
            >
              {loading ? <Loader2 size={14} /> : <GitCompare size={14} />}
              {t('compareAnalyses')}
            </button>
            {error && <p className="path-summary" style={{ color: 'var(--red)' }}>{error}</p>}
          </section>

          {result && (
            <>
              <section className="panel-section two-column">
                <div className="list-panel">
                  <h2 className="panel-heading">{result.base.repository}</h2>
                  <p className="path-summary">{formatDate(result.base.completedAt)}</p>
                  <p className="path-summary">{result.base.provider} · {result.base.model}</p>
                </div>
                <div className="list-panel">
                  <h2 className="panel-heading">{result.target.repository}</h2>
                  <p className="path-summary">{formatDate(result.target.completedAt)}</p>
                  <p className="path-summary">{result.target.provider} · {result.target.model}</p>
                </div>
              </section>

              <section className="panel-section metric-grid">
                <article className="metric-card">
                  <span className="metric-label">{t('entryChanges')}</span>
                  <span className="metric-value">{result.counts.entries.added + result.counts.entries.removed + result.counts.entries.changed}</span>
                  <span className="metric-detail">
                    {t('added')} {result.counts.entries.added} · {t('removed')} {result.counts.entries.removed} · {t('changed')} {result.counts.entries.changed}
                  </span>
                </article>
                <article className="metric-card">
                  <span className="metric-label">{t('flowChanges')}</span>
                  <span className="metric-value">{result.counts.flows.added + result.counts.flows.removed + result.counts.flows.changed}</span>
                  <span className="metric-detail">
                    {t('added')} {result.counts.flows.added} · {t('removed')} {result.counts.flows.removed} · {t('changed')} {result.counts.flows.changed}
                  </span>
                </article>
                <article className="metric-card">
                  <span className="metric-label">{t('decisionChanges')}</span>
                  <span className="metric-value">{result.counts.decisions.added + result.counts.decisions.removed + result.counts.decisions.changed}</span>
                  <span className="metric-detail">
                    {t('added')} {result.counts.decisions.added} · {t('removed')} {result.counts.decisions.removed} · {t('changed')} {result.counts.decisions.changed}
                  </span>
                </article>
                <article className="metric-card">
                  <span className="metric-label">{t('evidenceChanges')}</span>
                  <span className="metric-value">{result.counts.evidence.target}</span>
                  <span className="metric-detail">
                    {result.counts.evidence.sourceVerified} source verified · {result.counts.evidence.docVerified} doc verified · {result.counts.evidence.inferred} inferred
                  </span>
                </article>
              </section>

              {[
                { title: t('entryChanges'), items: entryChanges },
                { title: t('flowChanges'), items: flowChanges },
                { title: t('decisionChanges'), items: decisionChanges },
              ].map((section) => (
                <section className="panel-section" key={section.title}>
                  <h2 className="panel-heading">
                    <ArrowRight size={15} />
                    {section.title}
                  </h2>
                  {section.items.length === 0 ? (
                    <p className="path-summary">{t('noDifferences')}</p>
                  ) : (
                    <div className="path-list">
                      {section.items.map((change) => (
                        <article className="path-item" key={`${change.kind}-${change.id}`}>
                          <div className="path-check">
                            <GitCompare size={15} />
                          </div>
                          <div>
                            <div className="path-header">
                              <h3 className="path-title">{change.name}</h3>
                              <span className="tag">{change.status}</span>
                            </div>
                            {change.baseSummary && (
                              <p className="path-summary">Base: {change.baseSummary}</p>
                            )}
                            {change.targetSummary && (
                              <p className="path-summary">Target: {change.targetSummary}</p>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
