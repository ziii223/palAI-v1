# PalAI Check â€” architecture

## Build decision

Use one TypeScript project with a React + Vite frontend and a small Express backend. Use a supported Node LTS version compatible with the installed tooling; record exact versions when scaffolding. The backend/integration owner maintains the shared package and lockfile.

Production: Express serves the built frontend, /api routes, and the fixed PDF from one origin. Choose a host that runs a persistent Node process; this initial design uses in-memory conversations and pending consent, so multi-instance/serverless deployment needs shared session storage before it can preserve these semantics.

Development: Vite proxies /api to Express. The final browser UI and the temporary backend tester call the same real endpoints.

## Ownership and folders to create during implementation

| Path | Responsibility / owner |
| --- | --- |
| src/ | React screens/components, composer, browser recording, photo preprocessing, API adapter, PDF viewer â€” FRONTEND |
| server/ | Express, provider adapters, validation, evidence, anonymous sessions, consent â€” BACKEND |
| shared/types.ts | Types matching API_CONTRACT.md â€” BACKEND/integration owner |
| dev/backend-tester/ | Minimal development-only tester â€” BACKEND |
| data/palaycheck/ | Actual source PDF, manifest, page-local evidence â€” BACKEND |
| docs/design-references/ | User-provided visual inspiration â€” FRONTEND |

These are planned paths; this documentation pack does not contain product code.

## Request flow

1. Frontend sends text, language and optional photo to /api/chat.
2. Backend loads/creates the anonymous conversation, checks input limits and pending actions, and obtains relevant PalayCheck evidence.
3. Backend calls DeepSeek with system rules, source-tagged context, the current question/photo, and bounded conversation context.
4. Validate structured output and evidence IDs. Resolve references from the canonical manifest.
5. Return grounded guidance, a clarification, or an outside-PDF consent request.
6. Only /api/consent with a matching server-held pending question can produce a general answer.
7. Browser renders references/warnings from the validated response kind, never by guessing from answer text.

## PDF preparation and grounding

The actual PalayCheck PDF is still required. Backend Phase 1 must inspect extractability, diagrams/tables, length, and source edition.

Prepare page-local passages with stable IDs and physical PDF page positions. Do not merge chunks across pages. Store original printed labels separately.

Prefer sending all page-tagged extracted text if it fits the selected model's measured context and acceptable latency. Otherwise use a small page-local retrieval index with a bilingual query expansion step, checking English and Filipino questions against known evidence. Record the selected strategy and measured request behavior in BACKEND progress.

A zero-hit lexical search does not establish that a topic is outside the PDF. Verify the decision against the source context or return an uncertainty/retry rather than a false boundary claim.

Use simple local source preparation; no autonomous tool-executing agent is needed. Verify reference support manually on representative answers. Passage-ID validation prevents invalid page mappings but does not by itself prove claim support.

## Model providers

| Purpose | Provider / model | Server variable |
| --- | --- | --- |
| Text, photo context, grounded/general answers | DeepSeek; verify image-capable deepseek-flash using the user's account | DEEPSEEK_API_KEY |
| Speech transcription | Groq; whisper-large-v3-turbo | GROQ_API_KEY |

Provider integration is specified, not tested. Initial checks must call both services with real examples without logging keys. DeepSeek photo access must succeed before F03 is marked complete. Groq uses /audio/transcriptions, preserving original language; do not use English translation for this flow.

Keep model/base-URL settings configurable on the server. Use a finite response token budget and network timeout. One bounded correction attempt for malformed structured output is sufficient; never retry indefinitely.

## Environment

During implementation create a gitignored backend .env and a committed .env.example with blank secrets:
~~~dotenv
DEEPSEEK_API_KEY=
GROQ_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
GROQ_STT_MODEL=whisper-large-v3-turbo
PORT=3001
~~~

Deployment reads these through the host's environment settings. Frontend may use a public API base URL if required, but never a secret. No VITE_ or NEXT_PUBLIC_ provider-key variables.

## Session, upload and cost controls

- Random, unguessable conversation IDs; browser stores its ID in tab memory.
- In-memory sessions expire after 60 minutes idle; cap active sessions and bounded message history.
- Keep source status on each assistant message. General answers never become evidence.
- Permit one active photo per conversation; validate format, dimensions and size.
- Hold audio only for transcription and clean up temporary files even on failure. Do not retain raw audio as a product record.
- Rate-limit chat/consent/transcription and cap simultaneous upstream requests. Bound request bodies and output sizes.
- Use idempotency for repeated clicks and retries to avoid duplicate generations.
- Return controlled failures for timeouts, quota errors, expired sessions and missing sources.
- Serve user-provided text as text/sanitized Markdown. Do not log raw audio, photo bytes or secrets.

## Development commands to establish in Backend Phase 1

Provide and verify package scripts: npm run dev (both servers), npm run build, npm run typecheck, npm run test, and npm start (production).
Record the actual commands/versions and host choice in PLAN.md. Do not claim these commands work before scaffolding exists.

The tester has a question field, photo field, send button, transcript test input, response JSON, and consent controls. It lives outside the production frontend build. It is a development aid, not an additional product screen.

## Integration

Freeze shared interfaces first. Frontend initially uses fixtures matching API_CONTRACT.md behind its API adapter, then switches that adapter to live routes. Integrate the first real text answer by minute 60. Deployment and phone checks happen before final polish.
