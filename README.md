# zealdocs.org backend

Bun/Elysia application serving `api.zealdocs.org` and `go.zealdocs.org`.

Docsets are updated daily using GitHub Actions.

## Routes

| Host | Path | Description |
|------|------|-------------|
| `*.zealdocs.org` | `GET /` | Redirect to `https://zealdocs.org` |
| `api.zealdocs.org` | `GET /v1/releases` | Zeal release list |
| `api.zealdocs.org` | `GET /v1/docsets` | Docset catalog |
| `go.zealdocs.org` | `GET /l/:linkId` | Link redirects |
| `go.zealdocs.org` | `GET /d/:sourceId/:docsetId/:version` | Redirect to nearest Kapeli mirror (`latest` or specific version) |

## Development

```bash
bun install
bun run dev   # hot-reload dev server on :3000
bun test      # run tests
```

## Feed processing

```bash
bun run process-feeds \
  --manifest=docsets.json \
  --blacklist=blacklist.json \
  --resource-dir=<Dash-X-Platform-Resources> \
  <feeds-dir> \
  public/_api/v1/docsets.json
```

## Deploy

Deployment to Vercel is handled automatically by the GitHub Actions workflow on every push to `main` and on a daily schedule.
