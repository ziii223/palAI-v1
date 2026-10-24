# PalAI Check v1 checkpoint

Rice-guidance backend grounded in the included PalayCheck System 2020 Revised PDF.
This checkpoint includes the development tester; the production frontend is still
a placeholder. See [backend handoff](docs/BACKEND_HANDOFF.md),
[API contract](docs/API_CONTRACT.md) and [current progress](docs/PLAN.md).

## Reproduce locally

Requires Node 24.20.0 or a compatible Node 24 release, npm, and both `ffmpeg` and
`ffprobe` on PATH. The recorded local FFmpeg version is 9.0.2. These binaries are
required for the media validators and their automated tests; they are not bundled.

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
```

Enter your own provider keys locally in `.env`; never commit them. The example has
blank secrets and the existing model/port settings. No credentials are included.

```powershell
npm run dev:tester
```

Open http://127.0.0.1:3001/dev/backend-tester/ . Run only one backend on port 3001.
Text/consent, photo preparation and voice review use the same backend API routes.
Provider requests can incur charges; selecting media does not itself send a question.
Only explicit Send calls chat. Real crop-photo and English/Filipino speech acceptance
remain unverified without genuine samples; no full-document evidence coverage is claimed.

Other commands:

- `npm run dev`: backend plus Vite at http://127.0.0.1:5173, with `/api` proxied to 3001.
- `npm run typecheck`, `npm test`, `npm run build`: local checks; ordinary tests use
  mocks and synthetic validation fixtures, with no paid provider calls.
- `npm start`: built backend/client on port 3001; the development tester is excluded.

The canonical PDF and all runtime evidence/review files are in `data/palaycheck/`.
Git attributes preserve their exact bytes across platforms. Python is only needed
to rerun source-preparation scripts; see that folder's README and pinned requirements.
Private samples may be placed in ignored `dev/provider-samples/` with original extensions.

## Snapshot boundaries

Includes source, tests, lockfile, configuration, project documents, prepared source,
tester and the existing project-local skill documents/license notices. Skill presence
does not require running or reinstalling them; Graphify has not been run for this snapshot.

Actual environment files, dependencies, builds, caches, browser state, private media,
temporary uploads and generated screenshots under `output/` are excluded and left
intact locally. Historical screenshot links in progress reports refer to those local
artifacts; sanitized JSON verification records remain included.

Baseline publication does not establish teammate receipt, final frontend integration,
deployment or complete Phase 2 media acceptance.
