import { BookOpen, Boxes, FileCode2, LineChart, Route } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface OverviewPanelProps {
  project: Project;
}

export function OverviewPanel({ project }: OverviewPanelProps) {
  const { t } = useI18n();
  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('projectOverview')}</h1>
          <p className="section-subtitle">{project.summary}</p>
          {project.analysisMode === 'static' && (
            <span className="tag analysis-mode-tag">{t('staticFallback')}</span>
          )}
        </div>
      </div>

      <section className="panel-section">
        <h2 className="panel-heading">
          <LineChart size={15} />
          {t('complexitySnapshot')}
        </h2>
        <div className="metric-grid">
          {project.complexity.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <span className="metric-label">{metric.label}</span>
              <span className="metric-value">{metric.value}</span>
              <span className="metric-detail">{metric.detail}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-section two-column">
        <div className="list-panel">
          <h2 className="panel-heading">
            <Boxes size={15} />
            {t('coreModules')}
          </h2>
          <ul className="simple-list">
            {project.coreModules.map((module) => (
              <li key={module}>
                <Boxes size={14} />
                {module}
              </li>
            ))}
          </ul>
        </div>
        <div className="list-panel">
          <h2 className="panel-heading">
            <FileCode2 size={15} />
            {t('mostImportantFiles')}
          </h2>
          <ul className="simple-list">
            {project.importantFiles.map((file) => (
              <li key={file}>
                <FileCode2 size={14} />
                {file}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-heading">
          <BookOpen size={15} />
          {t('techStack')}
        </h2>
        <div className="tag-row">
          {project.techStack.map((item) => (
            <span className="tag" key={item}>
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-heading">
          <Route size={15} />
          {t('recommendedLearningPath')}
        </h2>
        <div className="two-column">
          <div className="list-panel">
            <ol className="simple-list">
              {project.learningPath.slice(0, 2).map((step) => (
                <li key={step.id}>
                  <Route size={14} />
                  <span>
                    <strong>{step.title}</strong>
                    <br />
                    <span className="metric-detail">{step.summary}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="list-panel">
            <ol className="simple-list">
              {project.learningPath.slice(2).map((step) => (
                <li key={step.id}>
                  <Route size={14} />
                  <span>
                    <strong>{step.title}</strong>
                    <br />
                    <span className="metric-detail">{step.summary}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
