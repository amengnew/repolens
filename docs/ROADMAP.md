# RepoLens Development Roadmap

## Product Goal

RepoLens is a developer workbench for rapidly understanding open-source projects. Given a GitHub repository, it generates an interactive three-layer learning map:

1. **Entry map:** user roles, interfaces, commands, jobs, events, and other system entry points.
2. **Flow layer:** the chain of logic triggered by each entry, including calls, state changes, data reads and writes, async events, and error paths.
3. **Engineering decisions:** concrete data choices, compression rules, context handling, retries, degradation, security boundaries, and other trade-offs worth learning from.

The product is differentiated from generic AI wikis by its user-first learning perspective, source-backed evidence, and focus on engineering trade-offs rather than file-by-file summaries.

## Core Principles

- Start from user roles and entries, not directory structure.
- Represent every claim as structured data, not free-form prose.
- Bind important conclusions to repository evidence with file and line references.
- Separate verified facts from AI inference.
- Prioritize learning paths and interaction over static documentation.
- Make the first screen a real analysis workbench, not a marketing page.

## Target Users

- Developers evaluating whether to adopt an open-source project.
- Engineers learning AI Agent and application architectures.
- Contributors preparing to work on an unfamiliar repository.
- Technical writers, educators, and architecture researchers.

## Information Model

### Layer 1: Entries and Roles

Entry types:

- Frontend UI action
- Admin UI action
- HTTP API route
- WebSocket or SSE event
- CLI command
- Background job
- Queue consumer
- Webhook
- Agent tool
- MCP, plugin, or runtime interface

Each entry records:

- User or system role
- Input shape
- Authentication requirement
- Permissions
- Triggered flow IDs
- Source evidence

### Layer 2: Flows and Chains

Flow nodes:

- Controller or route
- Service or use case
- Agent planner
- Tool router
- Tool executor
- Model provider
- Queue producer
- Worker
- Database
- Cache
- Search index
- External API
- Event publisher
- Frontend state update

Edge types:

- `calls`
- `emits`
- `consumes`
- `reads`
- `writes`
- `returns`
- `triggers`
- `retries`
- `validates`
- `falls back`

Each flow records:

- Trigger condition
- Input and output
- Branching conditions
- State changes
- Sync or async behavior
- Error paths
- Evidence

### Layer 3: Engineering Decisions

Decision topics:

- Data structures and schema design
- Prompt and context organization
- Token compression and history trimming
- Streaming response handling
- Error classification
- Retries, timeouts, and backoff
- Degradation and fallback
- Idempotency
- Concurrency control
- Caching
- Security boundaries
- Permission model
- Multi-tenant isolation
- Provider abstraction
- Testing strategy
- Observability

Each decision records:

- Problem
- Current solution
- Important parameters
- Design rationale
- Alternatives
- Trade-offs
- Applicable boundaries
- Evidence

## Primary Screens

1. **Overview**
   - Project summary
   - Tech stack
   - Core modules
   - Top-level architecture
   - Recommended learning path
   - Complexity assessment
   - Most important files

2. **Entry Map**
   - Role swimlanes
   - Entry nodes
   - Entry type filters
   - Click-through into flows

3. **Flow Explorer**
   - Interactive flow graph
   - Node expansion
   - Data, control, event, and error-path highlighting
   - Request-lifetime animation
   - Role filtering

4. **Deep Dive**
   - Engineering decision themes
   - Source-backed rationale
   - Parameter tables
   - Alternatives and trade-offs

5. **Ask Repo**
   - Project-scoped Q&A
   - Answers with clickable citations
   - Follow-up questions from flow nodes

6. **Learning Path**
   - 15-minute quick tour
   - One-hour orientation
   - Architecture deep read
   - Contribution path

## Application Layout

Use a three-panel workbench:

- Left: project map and learning path
- Center: interactive flow or entry map
- Right: evidence, source code, and AI explanation

## Technology Stack

### Frontend

- React
- Vite
- TypeScript
- React Flow
- Monaco Editor
- Tailwind CSS
- Zustand for local state
- TanStack Query for server state

### Backend

- Node.js or Python FastAPI
- GitHub API and shallow git clone
- tree-sitter or language-specific parsers for static extraction
- PostgreSQL for analysis storage
- Redis for async analysis jobs
- Vector database for code and semantic retrieval

### AI Layer

- Structured JSON extraction with schema validation
- Multi-stage analysis tasks
- Entry identification
- Flow identification
- Error-path analysis
- Architecture summary
- Engineering-decision extraction
- Provider abstraction for OpenAI, DeepSeek, Anthropic, and Gemini
- Mock provider for deterministic local development and UI testing

## Anti-Hallucination Requirements

- Important conclusions must have source evidence.
- Static analysis results take priority over LLM inference.
- Distinguish `source verified`, `doc verified`, `inferred`, and `uncertain`.
- Unsupported claims are visually downgraded.
- Users can flag incorrect explanations.
- Every analysis is pinned to a commit.
- Cited line numbers must be validated after generation.

## MVP Scope

Required for the first usable release:

- Public GitHub URL input
- Automatic repository analysis
- Overview generation
- Entry map generation
- At least three core flows
- At least five engineering decisions
- Source evidence for every important conclusion
- Project-scoped Q&A
- Shareable analysis results

Out of scope for MVP:

- Private repositories
- Automatic refresh
- Plugin marketplace
- Online editing
- Community annotations
- IDE integration
- Complete multi-language support

## Milestones

### Current Status

- **M0 complete:** repository structure, TypeScript data model, and deterministic sample project are in place.
- **M1 complete:** Overview, Entry Map, Flow Explorer, Engineering Decisions, Ask Repo, Learning Path, and evidence panel are interactive.
- **M2 in progress:** GitHub repository ingestion, provider abstraction, a standalone `/api/analyze` service, request validation, commit pinning, and local JSON persistence are implemented. Remaining M2 work is PostgreSQL persistence, background job queue, and stronger source evidence extraction.
- **Evidence extraction added:** AI responses now request `sourcePath` and `sourceQuote`; the service verifies quotes against fetched repository files and marks results as source verified, doc verified, or inferred. Unit tests cover all three cases.
- **Async analysis jobs added:** `/api/analyze` returns a job ID, `/api/analysis/:jobId` exposes progress and stage, and the provider panel polls status while showing a progress bar. The in-memory queue runs up to two analyses concurrently.
- **Static analysis added:** The service now extracts Express-style and Python framework routes, Next.js App Router paths, Commander CLI commands, event handlers, cron/interval jobs, npm scripts, and dependency metadata before calling the model. The model receives these facts as high-confidence context.
- **Provider key isolation added:** Model API keys live in analysis API environment variables. The browser no longer sends or stores provider keys.
- **AI response schema validation added:** Entry roles and kinds, flow steps, decision fields, parameters, alternatives, trade-offs, and source references are validated before results enter the workspace. Unit tests cover valid and invalid responses.
- **Job persistence and history added:** Analysis jobs are persisted to `.data/jobs.json`, interrupted jobs are marked as failed after a service restart, and `/api/history` plus the frontend History view load completed analyses.
- **Provider runtime configuration added:** The AI provider view now shows configured status, accepts API keys, persists them to local `.env`, supports model selection, and tests provider connectivity. Structured JSON logs trace configuration, tests, analysis progress, cache hits, completion, and errors.
- **Custom OpenAI-compatible provider added:** Users can configure a full chat-completions endpoint and API key. The endpoint and key are persisted server-side, and requests use the DeepSeek-style Bearer authorization header.
- **Real Ask Repo AI chain added:** `/api/ask` sends the project summary, entries, flows, decisions, and source evidence back to the configured model, validates citations against analysis evidence, and supports both preset and custom questions with a one-click follow-up flow.
- **Error-path visualization added:** Flows now render each error path as a red branch node connected from the final core node, so failure behavior is visible inside the interactive graph instead of only in a side list.
- **Repository-centric navigation added:** New Analysis is the default entry and binds provider, model, and repository URL before analysis. The workspace then exposes the repository content under Current Repository, while Global Repository History groups analyses by repository and loads the latest result.
- The analysis API is zero-dependency Node HTTP in development, with Vite proxying `/api` requests to `http://127.0.0.1:3001`.

### M0: Product Foundation

- Establish repository structure.
- Define the analysis data schema.
- Build the React + Vite application shell.
- Create realistic sample data for one AI Agent project.

### M1: Interactive Prototype

- Implement Overview.
- Implement Entry Map with role swimlanes.
- Implement Flow Explorer with selectable nodes.
- Implement evidence panel with source references.
- Implement Engineering Decisions view.
- Support role and entry-type filtering.

### M2: Real Analysis Pipeline

- Clone a public repository.
- Extract routes, commands, workers, and event handlers.
- Generate structured LLM output.
- Merge static and semantic graphs.
- Store results in PostgreSQL.
- Pin every analysis to a commit.

### M3: Learning Experience

- Add learning paths.
- Add error-path visualization.
- Add request-lifetime animation.
- Add Deep Dive pages.
- Add Ask Repo with citations.

### M4: Accuracy and Trust

- Validate evidence line numbers.
- Add confidence labels.
- Add user correction flow.
- Add static code indexing.
- Support analysis diffing.

### M5: Growth and Ecosystem

- Support private repositories.
- Support shareable public links.
- Support community-curated learning maps.
- Support repository updates and re-analysis.
- Explore GitHub and IDE integrations.

## Success Criteria

- Analyze a roughly 10,000-line Agent project in under 10 minutes.
- At least 80% of flow nodes have source evidence.
- Key engineering conclusions have at least 90% citation accuracy.
- A developer can understand the main entries and core flows in 15 minutes.
- Every flow node can open an evidence panel.
- Q&A answers include clickable citations.

## Immediate Next Step

Build the M0/M1 interactive prototype with deterministic sample data. The prototype should demonstrate the product's three-layer model, evidence-backed interaction, and workbench layout before the real repository analysis pipeline is implemented.
