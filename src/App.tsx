import { useMemo, useState } from 'react';
import {
  Boxes,
  GitBranch,
  LayoutDashboard,
  Lightbulb,
  History,
  MessageSquare,
  Network,
  Route,
} from 'lucide-react';
import { sampleProject } from './data/sampleProject';
import { AskPanel } from './components/AskPanel';
import { DecisionsPanel } from './components/DecisionsPanel';
import { EntryMapPanel } from './components/EntryMapPanel';
import { EvidencePanel } from './components/EvidencePanel';
import { FlowExplorerPanel } from './components/FlowExplorerPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { LearningPathPanel } from './components/LearningPathPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { ProviderPanel } from './components/ProviderPanel';
import { localizeProject } from './data/localizeProject';
import { useI18n } from './i18n';
import { getAnalysisJob } from './ai/client';
import type { Project } from './types';

type ViewId = 'overview' | 'entries' | 'flows' | 'decisions' | 'ask' | 'path' | 'provider' | 'history';

const views: Array<{
  id: ViewId;
  labelKey: 'overview' | 'entries' | 'flows' | 'decisions' | 'ask' | 'path' | 'provider' | 'history';
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', labelKey: 'overview', icon: LayoutDashboard },
  { id: 'entries', labelKey: 'entries', icon: Network },
  { id: 'flows', labelKey: 'flows', icon: GitBranch },
  { id: 'decisions', labelKey: 'decisions', icon: Lightbulb },
  { id: 'ask', labelKey: 'ask', icon: MessageSquare },
  { id: 'path', labelKey: 'path', icon: Route },
  { id: 'provider', labelKey: 'provider', icon: Boxes },
  { id: 'history', labelKey: 'history', icon: History },
];

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [sourceProject, setProject] = useState(sampleProject);
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [selectedEntryId, setSelectedEntryId] = useState<string>('entry-send-message');
  const [selectedFlowId, setSelectedFlowId] = useState<string>('flow-chat');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('chat-route');
  const [selectedDecisionId, setSelectedDecisionId] = useState<string>('dec-context');
  const [selectedQuestion, setSelectedQuestion] = useState<string>(sampleProject.askSamples[0].question);
  const [selectedStepId, setSelectedStepId] = useState<string>(sampleProject.learningPath[0].id);
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const project = useMemo(() => localizeProject(sourceProject, language), [sourceProject, language]);

  const selectedEntry = project.entries.find((entry) => entry.id === selectedEntryId) ?? project.entries[0];
  const selectedFlow = project.flows.find((flow) => flow.id === selectedFlowId) ?? project.flows[0];
  const selectedNode =
    selectedFlow.nodes.find((node) => node.id === selectedNodeId) ?? selectedFlow.nodes[0];
  const selectedDecision =
    project.decisions.find((decision) => decision.id === selectedDecisionId) ?? project.decisions[0];
  const selectedSample =
    project.askSamples.find((sample) => sample.question === selectedQuestion) ?? project.askSamples[0];
  const selectedStep =
    project.learningPath.find((step) => step.id === selectedStepId) ?? project.learningPath[0];

  const evidenceContext = useMemo(() => {
    if (activeView === 'flows') {
      return {
        title: selectedNode.label,
        subtitle: selectedNode.description,
        evidenceIds: selectedNode.evidenceIds,
      };
    }

    if (activeView === 'decisions') {
      return {
        title: selectedDecision.title,
        subtitle: selectedDecision.solution,
        evidenceIds: selectedDecision.evidenceIds,
      };
    }

    if (activeView === 'entries') {
      return {
        title: selectedEntry.name,
        subtitle: `${selectedEntry.role} entry • ${selectedEntry.auth}`,
        evidenceIds: selectedEntry.evidenceIds,
      };
    }

    if (activeView === 'ask') {
      return {
        title: selectedSample.question,
        subtitle: selectedSample.answer,
        evidenceIds: selectedSample.evidenceIds,
      };
    }

    if (activeView === 'path') {
      const relatedEvidence = selectedStep.relatedDecisionIds
        .flatMap((decisionId) => {
          const decision = project.decisions.find((item) => item.id === decisionId);
          return decision ? decision.evidenceIds : [];
        })
        .slice(0, 3);
      return {
        title: selectedStep.title,
        subtitle: selectedStep.summary,
        evidenceIds: relatedEvidence,
      };
    }

    return {
      title: project.name,
      subtitle: project.summary,
      evidenceIds: project.importantFiles.slice(0, 0),
    };
  }, [
    activeView,
    project,
    selectedDecision,
    selectedEntry,
    selectedNode,
    selectedSample,
    selectedStep,
  ]);

  const handleSelectEntry = (entryId: string) => {
    const entry = project.entries.find((item) => item.id === entryId);
    if (!entry) return;
    setSelectedEntryId(entry.id);
    setSelectedFlowId(entry.flowId);
    const flow = project.flows.find((item) => item.id === entry.flowId);
    setSelectedNodeId(flow?.nodes[0]?.id ?? '');
    setActiveView('flows');
  };

  const handleSelectFlow = (flowId: string) => {
    const flow = project.flows.find((item) => item.id === flowId);
    if (!flow) return;
    setSelectedFlowId(flow.id);
    setSelectedNodeId(flow.nodes[0]?.id ?? '');
    const entry = project.entries.find((item) => item.flowId === flow.id);
    setSelectedEntryId(entry?.id ?? '');
  };

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
  };

  const handleSelectDecision = (decisionId: string) => {
    setSelectedDecisionId(decisionId);
  };

  const handleSelectQuestion = (question: string) => {
    setSelectedQuestion(question);
  };

  const handleSelectStep = (stepId: string) => {
    setSelectedStepId(stepId);
  };

  const handleToggleStep = (stepId: string) => {
    setCompletedStepIds((current) =>
      current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId],
    );
  };

  const handleAnalysisComplete = (nextProject: Project) => {
    setProject(nextProject);
    setSelectedEntryId(nextProject.entries[0]?.id ?? '');
    setSelectedFlowId(nextProject.flows[0]?.id ?? '');
    setSelectedNodeId(nextProject.flows[0]?.nodes[0]?.id ?? '');
    setSelectedDecisionId(nextProject.decisions[0]?.id ?? '');
    setSelectedQuestion(nextProject.askSamples[0]?.question ?? '');
    setSelectedStepId(nextProject.learningPath[0]?.id ?? '');
    setActiveView('overview');
  };

  const handleLoadHistoryProject = async (jobId: string) => {
    const job = await getAnalysisJob(jobId);
    if (!job.result) {
      throw new Error('History item does not contain a result');
    }
    handleAnalysisComplete(job.result);
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark">
            <Boxes size={19} />
          </div>
          <div className="brand-copy">
            <p className="brand-name">RepoLens</p>
            <p className="brand-repo">{project.repository}</p>
          </div>
        </div>
        <div className="repo-meta">
          <span className="commit-pill">commit {project.commit}</span>
          <span className="mode-pill">{t('sampleAnalysis')}</span>
          <button
            type="button"
            className="language-toggle"
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          >
            {t('language')}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="sidebar-title">{t('workspace')}</p>
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <button
                type="button"
                className="nav-button"
                key={view.id}
                aria-current={activeView === view.id}
                onClick={() => setActiveView(view.id)}
              >
                <Icon size={17} />
                {t(view.labelKey)}
              </button>
            );
          })}
          <div className="sidebar-footer">
            {t('evidenceBacked')}
            <br />
            {t('deterministicData')}
          </div>
        </aside>

        <div className="content-layout">
          <main className="primary-panel">
            {activeView === 'overview' && <OverviewPanel project={project} />}
            {activeView === 'entries' && (
              <EntryMapPanel
                project={project}
                selectedEntryId={selectedEntry.id}
                onSelectEntry={handleSelectEntry}
              />
            )}
            {activeView === 'flows' && (
              <FlowExplorerPanel
                project={project}
                selectedFlowId={selectedFlow.id}
                selectedNodeId={selectedNode.id}
                onSelectFlow={handleSelectFlow}
                onSelectNode={handleSelectNode}
              />
            )}
            {activeView === 'decisions' && (
              <DecisionsPanel
                project={project}
                selectedDecisionId={selectedDecision.id}
                onSelectDecision={handleSelectDecision}
              />
            )}
            {activeView === 'ask' && (
              <AskPanel
                project={project}
                selectedQuestion={selectedSample.question}
                onSelectQuestion={handleSelectQuestion}
              />
            )}
            {activeView === 'path' && (
              <LearningPathPanel
                project={project}
                completedStepIds={completedStepIds}
                onToggleStep={handleToggleStep}
                selectedStepId={selectedStep.id}
                onSelectStep={handleSelectStep}
              />
            )}
            {activeView === 'provider' && (
              <ProviderPanel onAnalysisComplete={handleAnalysisComplete} />
            )}
            {activeView === 'history' && (
              <HistoryPanel onLoadProject={handleLoadHistoryProject} />
            )}
          </main>

          <EvidencePanel
            project={project}
            title={evidenceContext.title}
            subtitle={evidenceContext.subtitle}
            evidenceIds={evidenceContext.evidenceIds}
          />
        </div>
      </div>
    </div>
  );
}
