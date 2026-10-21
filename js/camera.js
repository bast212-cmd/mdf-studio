// Prise de photo en direct (webcam / caméra du téléphone).
// Repli automatique sur le sélecteur natif (capture="environment") si getUserMedia n'est pas disponible
// (navigateur sans caméra ou site servi en HTTP hors localhost).
import { modal } from './ui.js';

function nativeCapture() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

/** Ouvre la caméra ; résout avec un tableau de Blob (photos prises). */
export async function capturePhotos({ title = 'Prendre une photo' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return nativeCapture();

  let facing = 'environment';
  let stream;
  const shots = [];
  let resolveFn;
  let resolved = false;
  const finish = (v) => { if (!resolved) { resolved = true; resolveFn?.(v); } };

  const m = modal({
    title,
    content: `
      <div class="camera">
        <video playsinline autoplay muted></video>
        <p class="muted small">Cadrez le meuble en entier, de face ou de trois-quarts, avec une lumière homogène. Vous pouvez prendre plusieurs photos.</p>
        <div class="shots"></div>
      </div>`,
    footer: `
      <button class="btn btn--light" data-switch>Changer de caméra</button>
      <button class="btn btn--ghost" data-shot>● Prendre la photo</button>
      <button class="btn" data-done disabled>Utiliser les photos (0)</button>`,
    onClose: () => { stream?.getTracks().forEach((t) => t.stop()); finish(shots); },
  });
  const video = m.el.querySelector('video');
  const doneBtn = m.el.querySelector('[data-done]');

  async function start() {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream;
    } catch (e) {
      // Caméra refusée ou indisponible : on propose le sélecteur natif (nécessite un clic utilisateur)
      m.el.querySelector('.camera').innerHTML = `<div class="alert alert--info">Impossible d'accéder à la caméra depuis le navigateur (${e.name || 'erreur'}).
        Sur téléphone, le bouton ci-dessous ouvre directement l'appareil photo.</div>
        <button class="btn btn--block" data-native>Ouvrir l'appareil photo / choisir une image</button>`;
      m.el.querySelector('[data-native]').onclick = async () => { const files = await nativeCapture(); shots.push(...files); m.close(); };
      m.el.querySelector('[data-shot]').disabled = true;
      m.el.querySelector('[data-switch]').disabled = true;
    }
  }

  return new Promise((resolve) => {
    resolveFn = resolve;
    m.el.querySelector('[data-switch]').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; start(); };
    m.el.querySelector('[data-shot]').onclick = () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => {
        shots.push(b);
        const img = document.createElement('img');
        img.src = URL.createObjectURL(b);
        m.el.querySelector('.shots').appendChild(img);
        doneBtn.disabled = false;
        doneBtn.textContent = `Utiliser les photos (${shots.length})`;
      }, 'image/jpeg', 0.92);
    };
    doneBtn.onclick = () => m.close();
    start();
  });
}
