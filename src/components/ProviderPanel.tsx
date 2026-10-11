import { useEffect, useState } from 'react';
import { Loader2, Play, PlugZap, Settings2 } from 'lucide-react';
import {
  analyzeRepository,
  configureProvider,
  getProviderConfigs,
  testProvider,
  type ProviderRuntimeConfig,
} from '../ai/client';
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
  const [providerConfigs, setProviderConfigs] = useState<ProviderRuntimeConfig[] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    getProviderConfigs()
      .then((configs) => {
        if (cancelled) return;
        setProviderConfigs(configs);
        const initial = configs.find((item) => item.id === provider) ?? configs[0];
        if (initial) setModel(initial.defaultModel);
      })
      .catch((error) => {
        if (cancelled) return;
        setProviderConfigs([]);
        setConnectionStatus('error');
        setConnectionMessage(error instanceof Error ? error.message : 'Failed to load providers');
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  const selectedConfig = providerConfigs?.find((item) => item.id === provider);
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
    setApiKey('');
    setConnectionStatus('idle');
    setConnectionMessage('');
    const nextConfig = providerConfigs?.find((item) => item.id === nextProvider);
    setModel(nextConfig?.defaultModel ?? providers.find((item) => item.id === nextProvider)?.defaultModel ?? '');
  };

  const handleSaveAndTest = async () => {
    setConnectionStatus('testing');
    setConnectionMessage(t('testingConnection'));

    try {
      if (provider !== 'mock' && apiKey.trim().length > 0) {
        await configureProvider({
          provider,
          apiKey: apiKey.trim(),
          persist: true,
        });
      }

      const result = await testProvider({
        provider,
        model,
        apiKey: apiKey.trim() || undefined,
      });
      const configs = await getProviderConfigs();
      setProviderConfigs(configs);
      setConnectionStatus('success');
      setConnectionMessage(
        `${t('connectionOk')} · ${t('latency')} ${result.latencyMs}ms · ${result.responsePreview}`,
      );
      setApiKey('');
    } catch (error) {
      try {
        setProviderConfigs(await getProviderConfigs());
      } catch {
        // Keep the original provider test error visible.
      }
      setConnectionStatus('error');
      setConnectionMessage(error instanceof Error ? error.message : 'Provider test failed');
    }
  };

  const handleAnalyze = async () => {
    setStatus('loading');
    setMessage('');
    setProgress(0);
    try {
      const result = await analyzeRepository(
        { repoUrl, provider, model, language },
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
          <p className="section-subtitle">{t('providerSubtitle')}</p>
        </div>
      </div>

      <section className="panel-section">
        <h2 className="panel-heading">
          <Settings2 size={15} />
          {t('provider')}
        </h2>
        <div className="filter-bar">
          {(providerConfigs ?? providers).map((item) => {
            const config = providerConfigs?.find((runtimeConfig) => runtimeConfig.id === item.id);
            return (
              <button
                type="button"
                className="filter-button"
                key={item.id}
                aria-pressed={provider === item.id}
                onClick={() => handleProviderChange(item.id)}
              >
                {providerLabels[item.id]}
                {config && (
                  <span className={config.configured ? 'provider-ready' : 'provider-missing'} />
                )}
              </button>
            );
          })}
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
            className="text-input"
          />
        </div>
        <div className="list-panel">
          <h2 className="panel-heading">{t('modelSelection')}</h2>
          <label className="detail-label" htmlFor="model">{t('model')}</label>
          <input
            id="model"
            type="text"
            list="provider-models"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="text-input"
          />
          <datalist id="provider-models">
            {(selectedConfig?.models ?? selectedProvider.models).map((modelOption) => (
              <option key={modelOption} value={modelOption} />
            ))}
          </datalist>
        </div>
      </section>

      <section className={provider === 'mock' ? 'panel-section' : 'panel-section two-column'}>
        {provider !== 'mock' && (
          <div className="list-panel">
            <h2 className="panel-heading">{t('apiKey')}</h2>
            <label className="detail-label" htmlFor="api-key">
              {selectedConfig?.configured ? t('configured') : t('notConfigured')}
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              placeholder={selectedConfig?.envKey ?? ''}
              onChange={(event) => setApiKey(event.target.value)}
              className="text-input"
            />
          </div>
        )}
        <div className="list-panel">
          <h2 className="panel-heading">{t('connectionOk')}</h2>
          <button
            type="button"
            className="filter-button"
            onClick={handleSaveAndTest}
            disabled={connectionStatus === 'testing'}
          >
            {connectionStatus === 'testing' ? <Loader2 size={14} /> : <PlugZap size={14} />}
            {connectionStatus === 'testing' ? t('testingConnection') : t('saveAndTest')}
          </button>
          {connectionMessage && (
            <p
              className="path-summary"
              style={{
                marginTop: '12px',
                color: connectionStatus === 'error' ? 'var(--red)' : 'var(--teal)',
              }}
            >
              {connectionMessage}
            </p>
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
          {status === 'loading' ? <Loader2 size={14} /> : <Play size={14} />}
          {status === 'loading' ? t('analyzing') : t('analyzeRepository')}
        </button>
        {message && (
          <p
            className="path-summary"
            style={{
              marginTop: '12px',
              color: status === 'error' ? 'var(--red)' : 'var(--teal)',
            }}
          >
            {message}
          </p>
        )}
        {status === 'loading' && (
          <div className="progress-bar" style={{ marginTop: '14px' }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
        <p className="path-summary">{t('localKeyStorage')}</p>
      </section>
    </div>
  );
}
