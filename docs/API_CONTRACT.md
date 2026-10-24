# PalAI Check â€” shared API contract

Status: agreed interface for implementation; endpoints are not implemented by this documentation pack.

Owner: BACKEND WORK. Both laptops use these definitions and matching sample responses. Coordinate changes before implementation. The backend will create shared/types.ts from this document during BACKEND PHASE 1.

## Transport and common rules

- Prefix: /api. JSON UTF-8 except multipart transcription and PDF bytes.
- Local frontend proxy forwards /api to the backend. Production uses one origin.
- Server keys never reach the browser.
- IDs are opaque strings. conversationId is random, server-created, and held in tab memory.
- A conversation expires after 60 minutes of inactivity. Expired/missing sessions produce SESSION_EXPIRED, without silently sending a pending action to a new chat.
- clientMessageId/clientActionId identify one submission. Repeated IDs return the same completed result or REQUEST_IN_PROGRESS, without another billable generation. Failed attempts can be retried safely; only successful answers enter history.
- A new message while another request or consent is pending returns a conflict. Resolve the current action first.
- All strings are rendered as text or sanitized Markdown; model output is never executed.

## POST /api/chat

First request creates a conversation when conversationId is null. A request must contain a nonempty question; attachments alone remain a draft.

Request:
~~~json
{
  "conversationId": null,
  "clientMessageId": "opaque-client-id",
  "language": "en",
  "message": "What is the Leaf Color Chart used for?",
  "image": null
}
~~~

language: en or fil. message: 1â€“4000 characters.
image: null or { "mimeType": "image/jpeg", "base64": "<encoded-image-bytes>" }.
Allow JPEG, PNG, WebP only after validating bytes. Maximum decoded image size: 4 MiB; frontend resizes/compresses large camera images and preserves orientation. Server JSON-body limit must allow base64 overhead (8 MiB minimum). Invalid/oversized formats return explicit errors, never a success with an ignored image.

Server stores bounded conversation context. It may retain one current photo for follow-ups; tell the model when an older photo is no longer in context. A new photo replaces the active photo.

Successful response:
~~~json
{
  "conversationId": "opaque-server-id",
  "assistantMessage": {
    "id": "opaque-message-id",
    "kind": "grounded",
    "text": "<answer supported by the cited evidence>",
    "references": [
      {
        "evidenceId": "p012-c01",
        "documentId": "palaycheck-v1",
        "pdfPage": 12,
        "printedLabel": null,
        "section": "<verified section title or null>"
      }
    ]
  },
  "pendingGeneral": null
}
~~~

The page and evidence values above are interface examples, not real citations.

assistantMessage.kind:
- grounded: substantive answer with at least one validated supporting reference.
- clarification: a relevant follow-up; references may be empty.
- consent_prompt: document lacks support; exact localized consent question; references empty.
- general: only returned from a successful Continue action; references empty.
- acknowledgement: brief social response/cancellation confirmation; references empty.

For a consent prompt:
~~~json
{
  "conversationId": "opaque-server-id",
  "assistantMessage": {
    "id": "opaque-message-id",
    "kind": "consent_prompt",
    "text": "This is outside PalayCheck. Would you like a general AI answer?",
    "references": []
  },
  "pendingGeneral": {
    "id": "opaque-pending-id",
    "question": "<the exact outstanding question or unsupported portion>"
  }
}
~~~

For partial coverage, kind may be grounded with valid references AND pendingGeneral non-null. The frontend appends the exact consent question below that answer with Continue / Cancel.

The backend, not the model, resolves evidenceId into canonical document/page metadata. A malformed or unsupported citation triggers a controlled correction/failure; do not silently display a grounded claim without evidence.

## POST /api/consent

Request:
~~~json
{
  "conversationId": "opaque-server-id",
  "pendingId": "opaque-pending-id",
  "clientActionId": "opaque-client-action-id",
  "decision": "continue",
  "language": "en"
}
~~~

decision: continue or cancel. A general-answer request without a matching pending question is rejected. The server uses its stored pending question, not an arbitrary client replacement.

Continue: same response envelope as /api/chat, kind general, references [], pendingGeneral null. The frontend always attaches the exact localized red warning to kind general. On generation failure, preserve the pending action so retry works.

Cancel: kind acknowledgement, localized "General answer cancelled.", references [], pendingGeneral null. No general-model call. Completed decisions cannot be reused for different questions; repeated same action is idempotent.

## POST /api/transcribe

multipart/form-data:
- audio: actual recorded audio file.
- language: en, fil, or auto.

Maximum upload: 10 MiB and 60 seconds. Accept actual supported browser-recorded formats (e.g. WebM or MP4) and compatible WAV/MP3/M4A; validate format and duration. Do not rename bytes to pretend they are another format.

Response:
~~~json
{ "text": "<transcript in the spoken language>" }
~~~

Use Groq whisper-large-v3-turbo via its transcription endpoint. Map fil to provider language code tl when appropriate; auto leaves provider language detection enabled. The frontend inserts the result as editable draft text and never auto-sends. If speech is absent or unusable, return EMPTY_TRANSCRIPT instead of inventing a question. Do not overwrite a draft the farmer edited while transcription was pending.

## GET /api/document

~~~json
{
  "documentId": "palaycheck-v1",
  "title": "<actual supplied document title>",
  "edition": "<verified edition or null>",
  "pageCount": 0,
  "sha256": "<hash of the actual PDF>",
  "pdfUrl": "/api/document/pdf"
}
~~~

pageCount must be the real positive count at runtime; 0 above only marks this schema example. Missing/unprepared source returns SOURCE_NOT_READY.

## GET /api/document/pdf

Return the exact prepared source PDF with application/pdf content type. Source bytes and evidence manifest must share the same hash. Frontend PDF.js loads pdfUrl and opens pdfPage (1-based physical page). A page link is an in-app action, not reliance on an external browser's PDF fragment behavior.

## Errors

Use non-2xx status plus:
~~~json
{
  "error": {
    "code": "UPSTREAM_UNAVAILABLE",
    "message": "We could not complete that request. Please try again.",
    "retryable": true
  }
}
~~~

| HTTP | Codes/examples |
| --- | --- |
| 400 | INVALID_REQUEST, INVALID_CONSENT, EMPTY_TRANSCRIPT, UNSUPPORTED_AUDIO |
| 404/410 | SESSION_EXPIRED, DOCUMENT_NOT_FOUND |
| 409 | REQUEST_IN_PROGRESS, CONSENT_PENDING, STALE_CONSENT |
| 413 | IMAGE_TOO_LARGE, AUDIO_TOO_LARGE |
| 422 | INVALID_MODEL_RESPONSE, UNREADABLE_IMAGE |
| 429 | RATE_LIMITED |
| 502/503/504 | UPSTREAM_UNAVAILABLE, SOURCE_NOT_READY, REQUEST_TIMEOUT |

Error messages must not expose credentials, stack traces, private prompts, or full upstream bodies. Retry-after guidance should be returned when available.
