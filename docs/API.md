# RepoLens Analysis API

## Base URL

Development: `http://127.0.0.1:3001`

## Endpoints

### `GET /api/health`

Returns service status.

### `POST /api/analyze`

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
```

### `GET /api/projects`

Returns cached analysis keys.

## Caching

Analysis results are cached by:

`repoUrl|provider|model|commit|language`

Repeated calls for the same repository, provider, model, commit, and language return the cached result without another model call.
