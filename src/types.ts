export type EntryKind =
  | 'http'
  | 'ui'
  | 'cli'
  | 'event'
  | 'job'
  | 'tool'
  | 'websocket';

export type Confidence = 'source verified' | 'doc verified' | 'inferred' | 'uncertain';

export interface Evidence {
  id: string;
  label: string;
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  confidence: Confidence;
}

export interface Entry {
  id: string;
  name: string;
  role: 'End user' | 'Admin' | 'Developer' | 'System' | 'External service';
  kind: EntryKind;
  input: string;
  auth: string;
  permissions: string[];
  flowId: string;
  evidenceIds: string[];
}

export interface FlowNode {
  id: string;
  label: string;
  type: 'ui' | 'api' | 'service' | 'agent' | 'tool' | 'model' | 'queue' | 'data' | 'external';
  description: string;
  evidenceIds: string[];
  decisionIds: string[];
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: 'call' | 'data' | 'event' | 'error' | 'auth';
}

export interface Flow {
  id: string;
  name: string;
  trigger: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  errorPaths: string[];
}

export interface Decision {
  id: string;
  title: string;
  topic: string;
  problem: string;
  solution: string;
  parameters: Array<{ key: string; value: string }>;
  rationale: string;
  alternatives: string[];
  tradeoffs: string[];
  evidenceIds: string[];
}

export interface LearningStep {
  id: string;
  title: string;
  duration: string;
  summary: string;
  relatedEntryIds: string[];
  relatedDecisionIds: string[];
}

export interface Project {
  name: string;
  repository: string;
  commit: string;
  summary: string;
  techStack: string[];
  complexity: { label: string; value: string; detail: string }[];
  coreModules: string[];
  importantFiles: string[];
  entries: Entry[];
  flows: Flow[];
  decisions: Decision[];
  learningPath: LearningStep[];
  evidence: Evidence[];
  askSamples: Array<{ question: string; answer: string; evidenceIds: string[] }>;
}
