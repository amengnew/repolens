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
  "apiKey": "sk-...",
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

## Caching

Analysis results are cached by:

`repoUrl|provider|model|commit|language`

Repeated calls for the same repository, provider, model, commit, and language return the cached result without another model call.
