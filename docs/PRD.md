# PalAI Check â€” product requirements

## Product

A mobile-first web chat assistant that helps rice farmers understand the selected PalayCheck PDF, ask follow-up questions, provide crop photos, and inspect the original evidence. Farmers start chatting immediately. The current conversation stays available while the page remains open, including when the PDF viewer opens and closes.

The interface prioritizes phone browsers and remains usable on laptops. English and Filipino are selectable response languages. Answers should be practical, concise, and understandable.

## Required features

| ID | Feature | Acceptance |
| --- | --- | --- |
| F01 | Conversational chat | A typed message is sent once, appears in the chat, receives a real backend response, and supports contextual follow-ups. |
| F02 | Suggested inquiries | A new chat displays 3â€“4 short inquiry cards under "You can askâ€¦". A tap immediately sends the full corresponding question once through the ordinary chat flow. |
| F03 | Photo input | Take/select one photo, preview, replace/remove, then send with a question. The backend actually supplies the photo to the vision model. |
| F04 | Voice input | Record, stop, transcribe through Groq Whisper, review/edit in the composer, then explicitly send. Recording/transcription never auto-sends the question. |
| F05 | English/Filipino | A language choice controls new answer language. Original messages and quoted evidence are preserved; the choice does not rewrite existing messages. |
| F06 | PDF-grounded guidance | Guidance may combine relevant passages from the selected PalayCheck edition into a supported conclusion; no exact matching sentence or single complete-answer page is required. Answer directly; explain genuine evidence limitations and ask relevant follow-ups. |
| F07 | Expandable References and Direct PDF Page Viewer | Each PDF-supported substantive answer shows a small "Reference" button. Source details are collapsed initially. A tap reveals every cited page; selecting one opens the actual PDF inside PalAI at that exact page. Closing restores the chat and its position. |
| F08 | Outside-PDF consent | Before generating an answer beyond the document, ask "This is outside PalayCheck. Would you like a general AI answer?" and show Continue / Cancel. |
| F09 | General-answer warning | Only after Continue, generate that answer with the persistent red label "This is outside PalayCheck PDF". It has no PalayCheck Reference button. |
| F10 | Loading and recovery | Show pending states, block accidental duplicate sends, preserve the draft/attachment or retryable message after errors, and offer a useful retry. |

## Evidence behavior

- Each reference belongs to its specific answer and fixed PDF edition.
- Each cited page must contain a supporting premise or guidance actually used in the conclusion, not merely discuss a similar topic. Several pages may jointly support the complete answer.
- Answer the farmer directly. Do not explain that pages were combined or that the exact scenario is absent from the guide. Return all supporting pages through the existing collapsed Reference feature.
- Only classify a question as outside PalayCheck when essential supporting knowledge is missing after assessing relevant passages, not because reasoning across passages is needed. Missing/unreviewed evidence is a source limitation, not proof of absence from the document.
- Preserve source-quality checks and citation accuracy. Do not invent missing causal links, unsupported quantities or guarantees when combining passages. Consent remains required before generating any answer beyond the document.
- Show printed page labels when available, while opening the correct physical PDF page. Distinguish them when they differ.
- Greetings, clarification questions, and technical errors need no invented Reference button.
- If the PDF covers only part of a request, answer the supported portion and separately ask permission for the rest.
- Missing information about the farm is not automatically an outside-document question. Ask a relevant follow-up.
- A failed retrieval or model request is a technical failure, not proof that the topic is outside the PDF.
- Every new question is assessed against the document again. Consent for one answer does not enable a global general-AI mode.
- Continue/Cancel is enforced on the backend for a particular pending question.
- A red label identifies unsupported source status; it does not excuse fabricated or unjustifiably precise advice.
- A photo observation is not a confirmed diagnosis. Separate farmer reports, visual observations, and document guidance.
- Previously generated general answers cannot become evidence for later PDF-grounded answers.

## Interaction requirements

The main screen contains a compact header, language control, scrollable conversation, and bottom composer with text, photo, microphone, and send actions. Suggested inquiries appear in the empty state and disappear once the conversation starts. A New chat action clearly resets the current conversation.

PalAI asks only follow-ups that materially affect its response. Direct document questions should receive a direct answer when evidence is sufficient.

English consent/warning strings above are exact. Provide faithful Filipino equivalents when Filipino is selected. Both languages use the same source and consent rules.

## Completion

The product is demo-ready only when the real chat, one real photo request, English/Filipino transcription samples, reference-to-page navigation, consent Continue/Cancel, return to grounded answering, and meaningful failure recovery are verified. Build progress and owners live in PLAN.md.
