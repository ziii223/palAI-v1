const audioQuestion = document.querySelector('#question');
const recordButton = document.querySelector('#record');
const stopButton = document.querySelector('#stop-recording');
const cancelAudioButton = document.querySelector('#cancel-audio');
const transcribeButton = document.querySelector('#transcribe');
const audioFile = document.querySelector('#audio-file');
const spokenLanguage = document.querySelector('#spoken-language');
const audioStatus = document.querySelector('#audio-status');
const elapsed = document.querySelector('#recording-time');
const transcript = document.querySelector('#transcript');
const appendTranscript = document.querySelector('#append-transcript');
const preview = document.querySelector('#audio-preview');
let audioState = 'idle';
let stream = null;
let recorder = null;
let recording = null;
let previewUrl = null;
let interval = null;
let deadline = null;
let controller = null;
let generation = 0;
let draftRevision = 0;

audioQuestion.addEventListener('input', () => { draftRevision++; });
const extensionFor = mime => ({ 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg' })[mime.split(';')[0].trim().toLowerCase()];
const recordingMime = typeof MediaRecorder === 'undefined' ? null
  : ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']
    .find(type => MediaRecorder.isTypeSupported(type));

function setAudioState(state, message) {
  audioState = state;
  audioStatus.textContent = message;
  const busy = ['requesting', 'recording', 'transcribing', 'stopping'].includes(state);
  recordButton.disabled = busy || !recordingMime || !navigator.mediaDevices?.getUserMedia;
  stopButton.disabled = state !== 'recording';
  cancelAudioButton.disabled = !busy && !recording;
  transcribeButton.disabled = busy || !recording;
  audioFile.disabled = spokenLanguage.disabled = busy;
  appendTranscript.disabled = !transcript.value || state === 'transcribing';
}

function releaseMicrophone() {
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  clearInterval(interval);
  clearTimeout(deadline);
}

function setRecording(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  recording = file;
  previewUrl = file ? URL.createObjectURL(file) : null;
  preview.src = previewUrl || '';
  preview.hidden = !file;
}

function cancelAudio() {
  generation++;
  controller?.abort();
  controller = null;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  releaseMicrophone();
  setRecording(null);
  audioFile.value = '';
  transcript.value = '';
  setAudioState('idle', 'Audio cancelled. Your question draft is unchanged.');
}

function stopRecording() {
  if (audioState !== 'recording' || !recorder) return;
  setAudioState('stopping', 'Finishing the recording...');
  recorder.stop();
  releaseMicrophone();
}

recordButton.addEventListener('click', async () => {
  if (recordButton.disabled) return;
  const token = ++generation;
  setRecording(null);
  transcript.value = '';
  elapsed.textContent = '0 / 60 seconds';
  setAudioState('requesting', 'Requesting microphone permission...');
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (token !== generation) { for (const track of acquired.getTracks()) track.stop(); return; }
    stream = acquired;
    const current = new MediaRecorder(stream, { mimeType: recordingMime });
    recorder = current;
    const chunks = [];
    let bytes = 0;
    current.ondataavailable = event => {
      if (token !== generation || !event.data.size) return;
      bytes += event.data.size;
      if (bytes > 10 * 1024 * 1024) {
        cancelAudio();
        setAudioState('error', 'Recording exceeded 10 MiB. Please record a shorter sample.');
        return;
      }
      chunks.push(event.data);
    };
    current.onerror = () => {
      if (token !== generation) return;
      cancelAudio();
      setAudioState('error', 'Recording failed. Check microphone access and try again.');
    };
    current.onstop = () => {
      if (token !== generation) return;
      releaseMicrophone();
      recorder = null;
      const mime = current.mimeType;
      const extension = extensionFor(mime);
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size || !extension) { setAudioState('error', 'No supported audio was recorded. Try another browser or select a file.'); return; }
      setRecording(new File([blob], `recording.${extension}`, { type: mime }));
      setAudioState('ready', `Recording ready (${mime}). Listen, then choose Transcribe audio.`);
    };
    current.start(250);
    const started = performance.now();
    interval = setInterval(() => { elapsed.textContent = `${Math.min(60, Math.floor((performance.now() - started) / 1000))} / 60 seconds`; }, 200);
    // Leave one second for browser encoder padding; the backend still enforces the actual 60-second duration.
    deadline = setTimeout(stopRecording, 59_000);
    setAudioState('recording', 'Recording. Stop when finished; maximum 60 seconds.');
  } catch {
    if (token !== generation) return;
    releaseMicrophone();
    setAudioState('error', 'Microphone unavailable or permission denied. You can select an audio file instead.');
  }
});

stopButton.addEventListener('click', stopRecording);
cancelAudioButton.addEventListener('click', cancelAudio);
document.querySelector('#reset').addEventListener('click', cancelAudio);
window.addEventListener('pagehide', cancelAudio);
audioFile.addEventListener('change', () => {
  const file = audioFile.files?.[0];
  generation++;
  transcript.value = '';
  if (!file || !file.size || file.size > 10 * 1024 * 1024) {
    setRecording(null);
    setAudioState('error', 'Choose a nonempty audio file, at most 10 MiB and 60 seconds.');
    return;
  }
  setRecording(file);
  setAudioState('ready', `${file.name} ready. Choose the spoken language, then Transcribe audio.`);
});

function insertTranscript(text, originalDraft, revision) {
  transcript.value = text;
  if (draftRevision !== revision || audioQuestion.value !== originalDraft) {
    setAudioState('ready', 'Transcript ready below. Your edited draft was preserved. Review and append it if wanted.');
  } else if (text.length > 4000) {
    setAudioState('ready', 'Transcript exceeds the question limit. Review the text below and copy a shorter question.');
  } else {
    audioQuestion.value = text;
    draftRevision++;
    setAudioState('ready', 'Transcript inserted. Review/edit the question, then explicitly press Send.');
    audioQuestion.focus();
  }
}

transcribeButton.addEventListener('click', async () => {
  if (transcribeButton.disabled || !recording) return;
  const token = ++generation;
  const originalDraft = audioQuestion.value;
  const revision = draftRevision;
  const body = new FormData();
  body.set('audio', recording, recording.name);
  body.set('language', spokenLanguage.value);
  const abort = new AbortController();
  controller = abort;
  const timeout = setTimeout(() => abort.abort(), 70_000);
  setAudioState('transcribing', 'Transcribing audio. You may keep editing the question draft.');
  try {
    const response = await fetch('/api/transcribe', { method: 'POST', body, signal: abort.signal });
    const data = await response.json();
    if (token !== generation) return;
    if (!response.ok) { setAudioState('error', `${data.error.code}: ${data.error.message}`); return; }
    if (typeof data.text !== 'string' || !data.text.trim()) { setAudioState('error', 'No usable transcript returned. Please record again.'); return; }
    insertTranscript(data.text, originalDraft, revision);
  } catch {
    if (token === generation) setAudioState('error', 'Transcription failed or timed out. Audio is retained for an explicit retry; your draft is unchanged.');
  } finally {
    clearTimeout(timeout);
    if (token === generation) controller = null;
  }
});

appendTranscript.addEventListener('click', () => {
  if (appendTranscript.disabled) return;
  const combined = [audioQuestion.value, transcript.value].filter(Boolean).join('\n');
  if (combined.length > 4000) { audioStatus.textContent = 'Combined question exceeds 4000 characters. Edit/copy a shorter question.'; return; }
  audioQuestion.value = combined;
  draftRevision++;
  audioStatus.textContent = 'Transcript appended. Review/edit the question, then explicitly press Send.';
  audioQuestion.focus();
});

setAudioState('idle', recordingMime ? 'Ready. Record or select a short audio file. No question is sent automatically.'
  : 'This browser has no supported recorder. You can select an audio file instead.');
