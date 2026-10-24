const form = document.querySelector('#chat-form');
const question = document.querySelector('#question');
const language = document.querySelector('#language');
const send = document.querySelector('#send');
const reset = document.querySelector('#reset');
const status = document.querySelector('#status');
const answers = document.querySelector('#answers');
const responseJson = document.querySelector('#response-json');
let conversationId = null;
let pending = false;
let retry = null;
let pendingGeneral = null;
let consentControls = null;
let actionRetry = null;
const consentText = {
  en: 'This is outside PalayCheck. Would you like a general AI answer?',
  fil: 'Hindi ito saklaw ng PalayCheck. Gusto mo bang magpatuloy sa pangkalahatang sagot ng AI?',
};

function renderAnswer(data, title, selectedLanguage) {
  const card = document.createElement('article');
  const prompt = document.createElement('h3');
  prompt.textContent = title;
  const kind = document.createElement('p');
  kind.textContent = `Response: ${data.assistantMessage.kind}`;
  const text = document.createElement('p');
  text.className = 'answer';
  text.textContent = data.assistantMessage.text;
  card.append(prompt, kind, text);
  if (data.assistantMessage.kind === 'general') {
    const warning = document.createElement('p');
    warning.className = 'general-warning';
    warning.textContent = selectedLanguage === 'fil' ? 'Hindi ito saklaw ng PalayCheck PDF' : 'This is outside PalayCheck PDF';
    card.append(warning);
  } else {
    for (const reference of data.assistantMessage.references) {
      const link = document.createElement('a');
      link.href = `/api/document/pdf#page=${reference.pdfPage}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = `${reference.evidenceId}: physical PDF page ${reference.pdfPage}, printed ${reference.printedLabel ?? 'unlabelled'}; ${reference.section ?? 'no section'}; document ${reference.documentId}`;
      card.append(link, document.createElement('br'));
    }
  }
  answers.append(card);
  if (data.pendingGeneral) {
    pendingGeneral = data.pendingGeneral;
    const controls = document.createElement('div');
    const label = document.createElement('p');
    label.textContent = data.assistantMessage.kind === 'consent_prompt' ? data.pendingGeneral.question : consentText[selectedLanguage];
    controls.append(label);
    const buttons = ['continue', 'cancel'].map(decision => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = selectedLanguage === 'fil' ? (decision === 'continue' ? 'Magpatuloy' : 'Kanselahin') : (decision === 'continue' ? 'Continue' : 'Cancel');
      button.addEventListener('click', () => decide(decision));
      controls.append(button);
      return button;
    });
    consentControls = { controls, buttons };
    card.append(controls);
  }
}

async function decide(decision) {
  if (pending || !pendingGeneral) return;
  const selectedLanguage = language.value;
  const signature = JSON.stringify([conversationId, pendingGeneral.id, decision, selectedLanguage]);
  const clientActionId = actionRetry?.signature === signature ? actionRetry.id : crypto.randomUUID();
  actionRetry = { signature, id: clientActionId };
  pending = true;
  globalThis.palaiPhotoDraft?.lock(true);
  send.disabled = reset.disabled = language.disabled = true;
  for (const button of consentControls.buttons) button.disabled = true;
  status.textContent = 'Processing decision...';
  try {
    const response = await fetch('/api/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, pendingId: pendingGeneral.id, clientActionId, decision, language: selectedLanguage }) });
    const data = await response.json();
    responseJson.textContent = JSON.stringify(data, null, 2);
    if (!response.ok) {
      status.textContent = `${data.error.code}: ${data.error.message}`;
      return;
    }
    renderAnswer(data, pendingGeneral.question, selectedLanguage);
    pendingGeneral = null;
    actionRetry = null;
    consentControls.controls.replaceChildren();
    consentControls = null;
    status.textContent = 'Decision completed. You can ask another question.';
  } catch {
    status.textContent = 'Decision failed. Retry the same choice to reuse its action ID.';
  } finally {
    pending = false;
    send.disabled = !!pendingGeneral;
    reset.disabled = language.disabled = false;
    globalThis.palaiPhotoDraft?.lock(false);
    if (consentControls) for (const button of consentControls.buttons) button.disabled = false;
  }
}


fetch('/api/document').then(async response => {
  const data = await response.json();
  document.querySelector('#document-status').textContent = response.ok
    ? `${data.title} (${data.edition}), ${data.pageCount} physical pages. Source SHA-256: ${data.sha256}`
    : data.error.message;
}).catch(() => { document.querySelector('#document-status').textContent = 'Could not load document metadata.'; });

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || pendingGeneral || !question.value.trim()) return;
  const photo = globalThis.palaiPhotoDraft?.snapshot() ?? { image: null, version: 0, blocked: false };
  if (photo.blocked) { status.textContent = 'Wait for photo preparation, or remove/replace the invalid photo before sending.'; return; }
  const draft = question.value;
  const selectedLanguage = language.value;
  const signature = JSON.stringify([conversationId, draft, selectedLanguage, photo.image]);
  const clientMessageId = retry?.signature === signature ? retry.id : crypto.randomUUID();
  retry = { signature, id: clientMessageId };
  pending = true;
  globalThis.palaiPhotoDraft?.lock(true);
  send.disabled = reset.disabled = language.disabled = true;
  status.textContent = 'Preparing answer…';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, clientMessageId, language: selectedLanguage, message: draft, image: photo.image }),
    });
    const data = await response.json();
    responseJson.textContent = JSON.stringify(data, null, 2);
    if (!response.ok) {
      status.textContent = `${data.error.code}: ${data.error.message}`;
      return;
    }
    conversationId = data.conversationId;
    retry = null;
    renderAnswer(data, draft, selectedLanguage);
    if (photo.image) globalThis.palaiPhotoDraft?.sent(photo.version);
    if (question.value === draft) question.value = '';
    status.textContent = pendingGeneral ? 'Choose Continue or Cancel for the outstanding question.' : 'Answer received. Ask a follow-up in the same conversation.';
    question.focus();
  } catch {
    status.textContent = 'Request failed. Your draft is preserved; Send retries the same submission.';
  } finally {
    pending = false;
    send.disabled = !!pendingGeneral;
    reset.disabled = language.disabled = false;
    globalThis.palaiPhotoDraft?.lock(false);
  }
});

reset.addEventListener('click', () => {
  if (pending) return;
  conversationId = null;
  globalThis.palaiPhotoDraft?.reset();
  retry = null;
  pendingGeneral = null;
  consentControls = null;
  actionRetry = null;
  send.disabled = false;
  answers.replaceChildren();
  responseJson.textContent = 'No request yet.';
  status.textContent = 'New conversation started.';
  question.focus();
});
