import { useState } from 'react';
import { Loader2, Play, Settings2 } from 'lucide-react';
import { analyzeRepository } from '../ai/client';
import { providers, type ProviderId } from '../ai/providers';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface ProviderPanelProps {
  onAnalysisComplete: (project: Project) => void;
}

export function ProviderPanel({ onAnalysisComplete }: ProviderPanelProps) {
  const { t, language } = useI18n();
  const [repoUrl, setRepoUrl] = useState('https://github.com/vercel/ai');
  const [provider, setProvider] = useState<ProviderId>('mock');
  const [model, setModel] = useState(providers[0].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);

  const selectedProvider = providers.find((item) => item.id === provider) ?? providers[0];
  const providerLabels: Record<ProviderId, string> = {
    mock: language === 'zh' ? 'Mock（本地示例）' : 'Mock (local sample)',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
  };

  const handleProviderChange = (nextProvider: ProviderId) => {
    setProvider(nextProvider);
    const nextConfig = providers.find((item) => item.id === nextProvider);
    if (nextConfig) setModel(nextConfig.defaultModel);
  };

  const handleAnalyze = async () => {
    setStatus('loading');
    setMessage('');
    setProgress(0);
    try {
      const result = await analyzeRepository(
        { repoUrl, provider, apiKey, model, language },
        ({ progress: nextProgress, stage }) => {
          setProgress(nextProgress);
          setMessage(stage);
        },
      );
      onAnalysisComplete(result);
      setStatus('success');
      setProgress(100);
      setMessage(`${t('analyzedWith')}: ${result.name} · ${providerLabels[selectedProvider.id]}`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Analysis failed');
    }
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('providerTitle')}</h1>
          <p className="section-subtitle">
            {t('providerSubtitle')}
          </p>
        </div>
      </div>

      <section className="panel-section">
        <h2 className="panel-heading">
          <Settings2 size={15} />
          {t('provider')}
        </h2>
        <div className="filter-bar">
          {providers.map((item) => (
            <button
              type="button"
              className="filter-button"
              key={item.id}
              aria-pressed={provider === item.id}
              onClick={() => handleProviderChange(item.id)}
            >
              {providerLabels[item.id]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section two-column">
        <div className="list-panel">
          <h2 className="panel-heading">{t('repository')}</h2>
          <label className="detail-label" htmlFor="repo-url">{t('githubUrl')}</label>
          <input
            id="repo-url"
            type="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            style={{ width: '100%', padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
          />
        </div>
        <div className="list-panel">
          <h2 className="panel-heading">{t('model')}</h2>
          <label className="detail-label" htmlFor="model">{t('model')}</label>
          <input
            id="model"
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            style={{ width: '100%', padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
          />
          {selectedProvider.requiresKey && (
            <>
              <label className="detail-label" htmlFor="api-key" style={{ marginTop: '12px' }}>{t('apiKey')}</label>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                style={{ width: '100%', padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
              />
            </>
          )}
        </div>
      </section>

      <section className="panel-section">
        <button
          type="button"
          className="filter-button"
          onClick={handleAnalyze}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {status === 'loading' ? t('analyzing') : t('analyzeRepository')}
        </button>
        {message && (
          <p className="path-summary" style={{ marginTop: '12px', color: status === 'error' ? 'var(--red)' : 'var(--teal)' }}>
            {message}
          </p>
        )}
        {status === 'loading' && (
          <div className="progress-bar" style={{ marginTop: '14px' }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
      </section>
    </div>
  );
}
