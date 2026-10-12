# RepoLens Analysis API

## Base URL

Development: `http://127.0.0.1:3001`

## Endpoints

### `GET /api/health`

Returns service status.

### `POST /api/analyze`

Creates an asynchronous analysis job.

Request:

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "language": "zh"
}
```

Response:

```json
{
  "jobId": "uuid",
  "status": "queued",
  "progress": 0,
  "stage": "Queued for analysis"
}
```

### `GET /api/analysis/:jobId`

Returns job status. When `status` is `complete`, the response includes the full project analysis in `result`.

```json
{
  "jobId": "uuid",
  "status": "running",
  "progress": 55,
  "stage": "Downloading key source files"
}
```

Completed result:

```json
{
  "jobId": "uuid",
  "status": "complete",
  "progress": 100,
  "stage": "Analysis complete",
  "result": {
    "name": "repo",
    "repository": "github.com/owner/repo",
    "commit": "commit_sha",
    "summary": "...",
    "techStack": ["..."],
    "entries": [],
    "flows": [],
    "decisions": [],
    "evidence": []
  }
}
```

### `GET /api/projects`

Returns cached analysis keys.

### `GET /api/history`

Returns the 50 most recently completed analysis jobs. Each item includes repository, commit, provider, model, language, completion time, and summary. Use `GET /api/analysis/:jobId` to load the full result.

### `GET /api/repositories`

Returns completed analyses grouped by repository. Each item includes the repository name, analysis count, latest job ID, latest commit, latest completion time, providers, models, and summary.

### `GET /api/providers`

Returns provider runtime configuration, including available models, endpoint, environment variable name, and whether the key is configured.

### `POST /api/provider/config`

Configures a provider API key. By default the key is persisted to the local `.env` file; send `persist: false` to update only the current server process.

For the custom OpenAI-compatible provider, the request also includes `endpoint`. The endpoint is persisted as `CUSTOM_AI_ENDPOINT`, and requests use `Authorization: Bearer <CUSTOM_AI_API_KEY>`.

### `POST /api/provider/test`

Tests provider connectivity with a selected model. Returns success, latency, and a response preview, or a structured error.

The server emits structured JSON logs for provider configuration, provider tests, analysis queueing, progress, cache hits, completion, and failures.

## Caching

Analysis results are cached by:

`repoUrl|provider|model|commit|language`

Repeated calls for the same repository, provider, model, commit, and language return the cached result without another model call.

## Provider keys

Model provider keys are configured in the analysis service environment, not in the browser:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

## Static analysis

Before calling the model, the service extracts:

- Express-style and Python framework routes
- Next.js App Router route paths
- Commander-style CLI commands
- Event handlers
- Cron and interval jobs
- npm scripts and dependency metadata

These facts are passed to the model as high-confidence context for entry and flow extraction.
