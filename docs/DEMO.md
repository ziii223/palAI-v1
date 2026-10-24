# PalAI Check â€” demo guide

## Opening

"PalAI helps rice farmers ask questions about PalayCheck in everyday language, add crop photos, and inspect the original pages behind an answer. When the guide does not support a question, the farmer chooses whether to receive a clearly marked general AI answer."

Demonstrate the actual deployed product, using the verified source PDF and real provider integrations.

## Preparation

- Knowledge verifier picks a simple question with a clearly supporting passage.
- Confirm its actual page mapping; all page mentions below are placeholders until checked.
- Prepare a real crop photo and a short English/Filipino recording.
- Confirm deployment, provider quota, phone camera/microphone permissions and document rendering.
- Make sure development fixtures and the backend tester are absent from the production UI.

## Sequence (approximately 3 minutes, adjust to event rules)

| Step | Farmer action | What to show |
| --- | --- | --- |
| 1 | Open PalAI on a phone | Immediate chat entry, language choice, suggested inquiries |
| 2 | Tap a verified suggested inquiry | Question sends automatically once |
| 3 | Read answer | Concise grounded response; Reference remains collapsed |
| 4 | Tap Reference and select a listed page | Actual supporting PDF page opens directly inside PalAI |
| 5 | Close viewer | Same conversation and position remain |
| 6 | Add crop photo and a question | Preview/replace controls; actual response acknowledges uncertainty and requests relevant context if needed |
| 7 | Record a short reply | Stop -> transcribe -> review/edit -> explicitly Send |
| 8 | Ask "How do I grow tomatoes in containers?" | Outside-PDF consent without generating the general answer |
| 9 | Cancel, then ask again and Continue | Cancel does not generate; Continue produces a red-labeled general answer without a Reference button |
| 10 | Ask a new supported rice question | PalayCheck grounding and Reference return; consent was not global |

Do not rehearse an agricultural answer by fabricating a source or page. If a live service fails, show the actual recovery behavior and describe the limit honestly.

## Sample conversation skeleton

Farmer: "What is the Leaf Color Chart used for?"
PalAI: [Answer from the supplied source, with supporting evidence IDs.]
Farmer: [Taps Reference -> actual supporting page -> closes viewer.]

Farmer: [Attaches photo.] "Should I add fertilizer?"
PalAI: [Explains what can be observed and asks only relevant missing context.]
Farmer: [Records, reviews and sends their answer.]

Farmer: "How do I grow tomatoes in containers?"
PalAI: "This is outside PalayCheck. Would you like a general AI answer?"
Farmer: Continue.
PalAI: [General answer with red text: "This is outside PalayCheck PDF".]

Farmer: [Asks a verified supported rice question.]
PalAI: [Grounded answer with its own collapsed Reference button.]

## Close

"The farmer can see both where an answer comes from and when it goes beyond the guide. The chat makes the guidance accessible, while the page viewer keeps the original evidence within reach."
