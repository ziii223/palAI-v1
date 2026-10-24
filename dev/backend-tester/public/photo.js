const photoFile = document.querySelector('#photo-file');
const photoCamera = document.querySelector('#photo-camera');
const removePhoto = document.querySelector('#remove-photo');
const photoPreview = document.querySelector('#photo-preview');
const photoStatus = document.querySelector('#photo-status');
let selectedPhoto = null;
let photoVersion = 0;
let photoPreparing = false;
let photoError = false;
let photoLocked = false;
let serverPhotoActive = false;
let photoPreviewUrl = null;

function photoControls() {
  photoFile.disabled = photoCamera.disabled = photoLocked || photoPreparing;
  removePhoto.disabled = photoLocked || (!selectedPhoto && !photoPreparing && !photoError);
}
function clearPhoto(message) {
  photoVersion++;
  photoPreparing = photoError = false;
  selectedPhoto = null;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
  photoPreview.hidden = true;
  photoPreview.removeAttribute('src');
  photoFile.value = photoCamera.value = '';
  photoStatus.textContent = message || (serverPhotoActive
    ? 'No new photo selected. The previous sent photo remains active for follow-ups; New conversation clears it.' : 'No photo selected.');
  photoControls();
}
const encodePhoto = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode photo.')), 'image/jpeg', quality);
});
const photoBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('Could not read photo.'));
  reader.readAsDataURL(blob);
});

async function selectPhoto(event) {
  if (photoLocked) return;
  const file = event.target.files?.[0];
  if (!file) return;
  const token = ++photoVersion;
  photoPreparing = true;
  photoError = false;
  photoStatus.textContent = 'Preparing photo; nothing is sent yet...';
  photoControls();
  let bitmap;
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Select a JPEG, PNG or WebP photo.');
    if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('Select a nonempty photo no larger than 32 MiB before resizing.');
    if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot prepare photo orientation. Please use a current browser.');
    // Browser applies EXIF orientation before canvas encoding, which removes orientation metadata from the new pixels.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (token !== photoVersion) return;
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64_000_000) throw new Error('This photo is too large to prepare. Export a smaller photo first.');
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare photos. Try a current browser.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let encoded;
    for (const quality of [0.88, 0.72, 0.55]) {
      encoded = await encodePhoto(canvas, quality);
      if (encoded.size <= 4 * 1024 * 1024) break;
    }
    if (!encoded || encoded.size > 4 * 1024 * 1024 || encoded.type !== 'image/jpeg') throw new Error('Could not prepare a JPEG below 4 MiB. Select a smaller photo.');
    const base64 = await photoBase64(encoded);
    if (token !== photoVersion) return;
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    selectedPhoto = Object.freeze({ mimeType: 'image/jpeg', base64 });
    photoPreviewUrl = URL.createObjectURL(encoded);
    photoPreview.src = photoPreviewUrl;
    photoPreview.hidden = false;
    photoStatus.textContent = `Photo ready: ${canvas.width} x ${canvas.height}, JPEG, ${Math.ceil(encoded.size / 1024)} KiB. Review it and Send with a question.`;
  } catch (error) {
    if (token !== photoVersion) return;
    photoError = true;
    photoStatus.textContent = `${error instanceof Error ? error.message : 'Photo could not be prepared.'} Remove or replace it before sending.`;
  } finally {
    bitmap?.close();
    if (token === photoVersion) { photoPreparing = false; photoControls(); }
  }
}
photoFile.addEventListener('change', selectPhoto);
photoCamera.addEventListener('change', selectPhoto);
removePhoto.addEventListener('click', () => clearPhoto());
globalThis.palaiPhotoDraft = {
  snapshot: () => ({ image: selectedPhoto, version: photoVersion, blocked: photoPreparing || photoError }),
  lock: locked => { photoLocked = locked; photoControls(); },
  sent: version => {
    serverPhotoActive = true;
    if (version === photoVersion) clearPhoto('Photo sent. It remains active on the server for relevant follow-ups. A new sent photo replaces it; New conversation clears it.');
  },
  reset: () => { serverPhotoActive = false; clearPhoto(); },
};
clearPhoto();
