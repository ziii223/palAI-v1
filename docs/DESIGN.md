# PalAI Check â€” design specification

## Direction

Flat design, with the color scheme inspired by the user's selected green storage-management UI reference:
https://www.magnific.com/premium-vector/modern-green-storage-management-app-ui-kit-template_6734751.htm

Use it as color/style inspiration, not a screen-for-screen template. PalAI's screens are built around conversation and source inspection. The exact palette has not been visually sampled or verified in this documentation task.

Place reference screenshots in docs/design-references/. Before implementation, inspect them and record sampled color values in the table below. If the reference cannot be viewed, ask for a locally accessible image; do not claim to have matched it or silently substitute a new palette.

| Token role | Selection |
| --- | --- |
| Primary green | Sample the approved reference |
| Light surface/background | Sample the approved reference, adapting for legibility |
| Text / secondary text | Choose readable contrast on those surfaces |
| Borders / selected states | Coordinate with sampled palette |
| Outside-PDF warning | Accessible dark red text plus icon and a light solid warning surface |

Use solid fills, simple line icons with labels where needed, consistent moderate corner rounding, and clear hierarchy. Avoid decorative transparency and heavy effects. Body text target: approximately 18 CSS px with comfortable line height; tune to the actual reference and phone rendering. Controls should generally have 48 CSS px or larger touch areas. Verify normal text contrast at least 4.5:1 and large text at least 3:1.

## Phone-first layout

- Compact header: PalAI identity, English/Filipino selector, New chat.
- Main area: readable scrollable conversation.
- Empty state: short welcome and 3â€“4 suggested inquiry cards under "You can askâ€¦".
- Bottom composer: expandable text field, photo control, microphone, and clearly identifiable Send.
- Respect device safe areas and the on-screen keyboard. Composer and consent controls must not be hidden behind browser UI.
- Fit narrow screens without horizontal page scrolling. On laptops use a centered comfortable reading width, not stretched chat lines.
- Preserve the current draft and chat when opening references or changing language.

## Message presentation

- Farmer messages: visually distinct alignment/background; attachment preview stays associated with its message.
- Assistant messages: concise paragraphs and short lists where useful.
- Distinguish pending, failed, and completed requests. Loading text should describe progress without claiming diagnosis.
- Auto-scroll when the reader is near the latest message. Do not drag them away from an older message they are reading.
- A failed message has retry controls; duplicate taps do not duplicate the request.
- Render Markdown safely; source documents and model output cannot supply executable markup.

## Reference interaction â€” required

1. A PDF-supported substantive answer has a small button labeled exactly "Reference".
2. Sources are collapsed by default. Use an actual keyboard-accessible button with expanded state.
3. On expansion show the document title and one clickable item per cited physical PDF page. Group multiple evidence passages on the same page.
4. Display a known printed label where useful; distinguish "PDF page N" if numbering differs or is absent.
5. Clicking opens an in-app viewer at the selected physical page of the actual PDF.
6. Viewer shows document title, current page/total, readable page rendering, Previous/Next, a fit-width/zoom option, and Close.
7. On phone use a full-height viewer surface. On laptop a roomy modal is acceptable.
8. Close restores chat scroll, draft, reference expansion, and focus to the originating page link.
9. Loading or PDF render failure has a message and retry. Never open a different page as if successful.

Use PDF.js to render the real PDF. Support opening any cited page directly; merely linking to the start of the document does not satisfy F07.

## Consent and general answers

Exact English consent:
"This is outside PalayCheck. Would you like a general AI answer?"

Buttons: Continue and Cancel. While processing a decision disable repeat actions. Do not silently grant consent through a suggested inquiry or ordinary Send.

General replies always have this persistent red text:
"This is outside PalayCheck PDF"

Use a warning icon and text, so color is not the only signal. No PalayCheck Reference button on general replies. Opening another reference or changing screens must not remove the warning.

If only part of the farmer's request is supported, show that grounded portion with references and a separate consent prompt for the rest.

## Input states

Photo: camera/gallery selection -> preview -> replace/remove -> submit with question. Resize appropriately without distorting or dropping orientation. Invalid formats and size failures must be actionable.

Voice: idle -> recording with elapsed time -> stop/cancel -> transcribing -> editable draft -> explicit Send. Cap recording at 60 seconds. Show errors for denied permission, no usable speech, and provider failure. If the farmer typed while transcription ran, offer insertion/replacement rather than silently overwriting their text.

Language choice affects subsequent AI answers and localized controls. Keep the original transcript for review; do not quietly translate it into another language.

New chat asks before discarding a nonempty draft or current conversation, then clears tab state and returns to suggested inquiries.

## Screen coverage

The frontend phase must cover: empty chat, active conversation, photo draft, recording/transcribing, grounded answer, expanded references, selected PDF page, consent pending, general warning, failed request, expired conversation, and keyboard-open phone layout.

Inspect supplied screenshots for visual treatment while following these product states.
