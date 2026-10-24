# Backend tester

Launch from the project root with `npm run dev:tester`, then open
`http://127.0.0.1:3001/dev/backend-tester/` (uses PORT from the local .env).
This command starts the real backend plus a separate text/consent/audio tester; Vite is
not required. Stop another backend on the same port before launching it.

Only approved excerpts are answer evidence: harvest readiness, flowering/ripening
water depth, LCC/nutrient principles and field leveling. This is partial coverage;
see docs/BACKEND_HANDOFF.md for exact pages and suggested inquiries. Other source
questions return a clarification/coverage limitation. Select English/Filipino,
send, inspect the actual JSON/references, and ask a contextual follow-up.
PDF links use physical page fragments as a development aid. The production
in-app PDF viewer remains frontend-owned.

`npm run smoke:text` retains the original five-case LCC regression smoke check.
`node --env-file-if-exists=.env --import tsx dev/backend-tester/smoke-expanded.ts`
runs the five expanded-coverage checks and writes their sanitized report. These
commands make paid calls; they do not retry. Ordinary `npm test` uses
stub providers and makes no paid calls.

The public tester assets are served only by this development entry point. They
are outside Vite's entry points and are not copied into the production build.

The tester console emits `development_chat_trace` for each POST /api/chat with
a local request ID (also returned as X-Local-Request-Id), UTC timestamp, response
origin, upstream status/response ID when supplied, returned model/token usage,
and elapsed time. No question, answer, source text, media or key is logged.
`local` can mean a validation/error response with no upstream attempt, or the
fixed source-limitation or consent wording after DeepSeek returns `source_limitation`
or the validated `outside` assessment;
check `upstreamAttempted` and `modelDecision` together. `application cache`
means a completed submission ID was replayed without another generation; its
usage is null, not repeated billing. `DeepSeek` means validated model-written
text. Tracing is enabled only by this separate development entry, not npm start.

Transcription: Record -> Stop -> listen -> Transcribe audio -> review/edit Question.
Only an explicit Send calls chat. Spoken language is separate from answer language.
Or select a real WebM, MP4/M4A, WAV, MP3, Ogg or FLAC audio file (10 MiB/60 seconds max).
Server validation requires ffprobe and ffmpeg on PATH; existing local version is 9.0.2.
If the draft changed during transcription, the result stays in the transcript area;
review it and use Append transcript if wanted. Cancel releases the microphone and
discards the pending local result. A request already sent may have reached Groq.
No real recording was supplied for BE-11 verification, so live English/Filipino
transcription is UNVERIFIED; unit fixtures/mocked failures are not live evidence.
Full manual steps and endpoint details: docs/BACKEND_HANDOFF.md, BE-11 section.

Photo: select a real JPEG/PNG/WebP or use the phone camera picker; inspect the preview,
replace/remove before Send, and always enter a question. Browser applies orientation
and prepares an at-most-2048px JPEG below 4 MiB. A failed Send retains the attachment
for an unchanged retry. A successful new photo replaces the server's current photo;
text follow-ups reuse it. Remove affects the draft only; New conversation clears the
session context. Source guidance and tentative observations remain separate.
No real crop photo was supplied: live vision is UNVERIFIED. Synthetic rectangles were
used only for decoder/UI checks, never claimed as crop interpretation. Server image
validation also requires existing ffprobe/ffmpeg on PATH. See handoff BE-10 section.
