# Tinybird workspace

Schema and queries for the analytics pipeline. The Bun/Elysia backend posts
events here from `src/track.ts` when `TINYBIRD_TOKEN` is set in the runtime
environment.

## Privacy

Analytics here are designed to be useful without identifying anyone.

- **No IP addresses are stored.** Vercel resolves geolocation server-side
  before tracking runs; only `country` and `region` (state/province) are kept
  — never the raw IP, never city.
- **No user accounts.** Zeal has none.
- **Anonymous install ID.** Zeal generates a random UUID per install and sends
  it only to `*.zealdocs.org` hosts. It is not derived from hardware, user, or
  any persistent OS identifier; a settings wipe regenerates it. Used for
  unique-install counts only.
- **What we record:** event type, route fields (source, docset, version,
  mirror), country, region, Zeal app version, Qt version, OS name and arch,
  locale, and the User-Agent string. Full schema in
  `datasources/events.datasource`.
- **What we don't record:** IP address, city, search queries, page views, file
  contents, or anything cross-correlatable with PII.

## Layout

- `datasources/events.datasource` — landing table (single events stream, all
  routes)
- `pipes/top_docsets.pipe` — top docsets by download count
- `pipes/country_breakdown.pipe` — audience by country
- `pipes/version_adoption.pipe` — Zeal app version distribution
- `pipes/real_downloads.pipe` — downloads with scrapers removed, base for
  human-usage views (tune `coverage`/`countries`/`days` params)

## Querying

No Docker needed when using `--cloud`. Run ad-hoc SQL against the cloud
workspace:

```bash
cd tinybird
tb --cloud sql "SELECT count() FROM events WHERE event = 'download'"
```

To validate pipe edits without deploying, use `tb --cloud deploy --check`
(see Deploy). It catches schema and pipe-file errors against the live
workspace and changes nothing.

## Deploy

No Docker needed when using `--cloud`:

```bash
cd tinybird
tb --cloud deploy --check    # dry-run validation against cloud workspace
tb --cloud deploy            # deploy to cloud main workspace
```

## Tokens

The append token used by the backend is declared inline at the top of
`datasources/events.datasource` (`TOKEN events_append APPEND`). Forward creates
and rotates it via deployments — copy its value from the workspace UI's
**Tokens** tab and set it as `TINYBIRD_TOKEN` in Vercel.

## Ingestion batching

`src/track.ts` micro-batches events into a single `/v0/events` POST instead of
one POST per event. One single-row insert creates one part in the datasource;
at our trickle of a few events per second that floods `events` with tiny parts
and trips the plan's accumulated-inserts limit during bursts (e.g. the daily
full-catalog sweep). Buffering coalesces events that share a warm serverless
instance into one insert, so the Gatherer writes fewer, larger parts. Tracking
is fire-and-forget, so the flush delay never adds latency to a response.

Confirm the effect after deploy (fewer ops, more rows per op):

```bash
tb --cloud sql "SELECT toStartOfHour(timestamp) AS h, count() AS ops, sum(rows) AS total_rows, round(avg(rows),1) AS avg_rows FROM tinybird.datasources_ops_log WHERE datasource_name='events' AND event_type='append-hfi' AND timestamp > now() - INTERVAL 24 HOUR GROUP BY h ORDER BY h DESC"
```

## Optional runtime env vars (defaults)

- `TINYBIRD_URL` — `https://api.us-east.aws.tinybird.co/v0/events` (override
  when the workspace is hosted in a different region)
- `TINYBIRD_DATASOURCE` — `events`
- `TINYBIRD_BATCH_MAX` — `20` (flush as soon as this many events are buffered)
- `TINYBIRD_BATCH_DELAY_MS` — `1000` (otherwise flush a partial batch after this
  long; raise to coalesce more aggressively, lower to send sooner)
