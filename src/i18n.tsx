import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Language = 'en' | 'zh';

const translations = {
  en: {
    overview: 'Overview',
    entries: 'Entries',
    flows: 'Flows',
    decisions: 'Decisions',
    ask: 'Ask repo',
    path: 'Learning path',
    provider: 'AI provider',
    workspace: 'Workspace',
    sampleAnalysis: 'Sample analysis',
    evidenceBacked: 'Evidence-backed prototype',
    deterministicData: 'Data is deterministic',
    projectOverview: 'Project overview',
    entryMap: 'Entry map',
    flowExplorer: 'Flow explorer',
    engineeringDecisions: 'Engineering decisions',
    askThisRepo: 'Ask this repo',
    learningPath: 'Learning path',
    aiProvider: 'AI provider',
    language: '中文',
    complexitySnapshot: 'Complexity snapshot',
    coreModules: 'Core modules',
    mostImportantFiles: 'Most important files',
    techStack: 'Tech stack',
    recommendedLearningPath: 'Recommended learning path',
    startFromEntry: 'Start from the person or system entering the application, then follow the chain of logic it triggers.',
    roleFilters: 'Role filters',
    entryTypes: 'Entry types',
    input: 'Input',
    auth: 'Auth',
    coreFlows: 'Core flows',
    selectedNode: 'Selected node',
    errorPaths: 'Error paths',
    problem: 'Problem',
    currentSolution: 'Current solution',
    parameters: 'Parameters',
    rationale: 'Rationale',
    alternatives: 'Alternatives',
    tradeoffs: 'Trade-offs',
    evidence: 'Evidence',
    questions: 'Questions',
    answer: 'Answer',
    citations: 'Citations',
    answersScoped: 'Answers are scoped to the analyzed commit and always link back to source evidence.',
    filterQuestions: 'Filter questions',
    providerTitle: 'AI provider',
    providerSubtitle: 'Connect a model provider, paste a GitHub link, and generate a modular repository breakdown.',
    repository: 'Repository',
    githubUrl: 'GitHub URL',
    model: 'Model',
    apiKey: 'API key',
    analyzeRepository: 'Analyze repository',
    analyzing: 'Analyzing',
    progressLabel: 'Learning path progress',
    selectEvidence: 'Select a node, entry, or decision to inspect its evidence.',
    markIncomplete: 'Mark as incomplete',
    markComplete: 'Mark as complete',
    analyzedWith: 'Analyzed',
  },
  zh: {
    overview: '项目总览',
    entries: '入口地图',
    flows: '链路浏览',
    decisions: '工程取舍',
    ask: '追问仓库',
    path: '学习路径',
    provider: 'AI 供应商',
    workspace: '工作区',
    sampleAnalysis: '示例分析',
    evidenceBacked: '带证据的原型',
    deterministicData: '数据为确定性示例',
    projectOverview: '项目总览',
    entryMap: '入口地图',
    flowExplorer: '链路浏览',
    engineeringDecisions: '工程取舍',
    askThisRepo: '追问这个仓库',
    learningPath: '学习路径',
    aiProvider: 'AI 供应商',
    language: 'EN',
    complexitySnapshot: '复杂度概览',
    coreModules: '核心模块',
    mostImportantFiles: '最重要的文件',
    techStack: '技术栈',
    recommendedLearningPath: '推荐学习路径',
    startFromEntry: '从进入应用的人或系统开始，再追踪它触发的链式逻辑。',
    roleFilters: '角色筛选',
    entryTypes: '入口类型',
    input: '输入',
    auth: '鉴权',
    coreFlows: '核心链路',
    selectedNode: '当前节点',
    errorPaths: '错误路径',
    problem: '问题',
    currentSolution: '当前方案',
    parameters: '关键参数',
    rationale: '设计理由',
    alternatives: '替代方案',
    tradeoffs: '代价',
    evidence: '证据',
    questions: '问题',
    answer: '回答',
    citations: '引用',
    answersScoped: '回答限定在被分析的 commit，并始终回到源码证据。',
    filterQuestions: '筛选问题',
    providerTitle: 'AI 供应商',
    providerSubtitle: '连接模型供应商，粘贴 GitHub 链接，生成模块化的仓库拆解。',
    repository: '仓库',
    githubUrl: 'GitHub 链接',
    model: '模型',
    apiKey: 'API Key',
    analyzeRepository: '分析仓库',
    analyzing: '正在分析',
    progressLabel: '学习路径进度',
    selectEvidence: '选择节点、入口或工程取舍后查看证据。',
    markIncomplete: '标记为未完成',
    markComplete: '标记为完成',
    analyzedWith: '已完成分析',
  },
} as const;

type TranslationKey = keyof typeof translations.en;

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('zh');

  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key: TranslationKey) => translations[language][key] ?? translations.en[key],
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside LanguageProvider');
  }
  return context;
}
