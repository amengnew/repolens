# RepoLens

RepoLens is an interactive workbench for understanding open-source repositories. Given a GitHub URL, it maps the project into three layers:

- Entry points and user roles
- Triggered flows and chains of logic
- Engineering decisions and trade-offs

## Features

- Bilingual interface: Chinese and English
- Interactive flow graph
- Evidence-backed decisions
- Learning paths
- AI provider abstraction: OpenAI, DeepSeek, Anthropic, Gemini, and Mock
- Local analysis API with caching and commit pinning

## Getting started

```bash
npm install
npm run dev:all
```

This starts:

- Frontend: http://127.0.0.1:5173
- Analysis API: http://127.0.0.1:3001

## Build

```bash
npm run build
```

## AI provider keys

Copy `.env.example` to `.env`, then set the key for the provider you want to use:

```bash
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

Keys are read by the local analysis API and are not sent through the browser.

## Documentation

- Development roadmap: `docs/ROADMAP.md`
- Analysis API: `docs/API.md`
