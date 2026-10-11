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

### `GET /api/compare/:baseJobId/:targetJobId`

Compares two completed analyses and returns metadata plus added, removed, changed, and unchanged entries, flows, and engineering decisions.

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
