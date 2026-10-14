// Si la pagina se sirve desde el backend (puerto 3000) se usa el mismo origen;
// si se sirve aparte (por ejemplo puerto 8080) se apunta al backend.
const API = location.port === '3000' ? '' : 'http://localhost:3000';
const MAX_SIZE_MB = 5;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const VIEW_SECONDS = 15 * 60; // igual que el backend (15 minutos)

const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');
const fileInfo = document.getElementById('fileInfo');
const gallery = document.getElementById('gallery');
const dropzone = document.getElementById('dropzone');
const toasts = document.getElementById('toasts');
const logEl = document.getElementById('log');

// ---------- Alertas visibles ----------
function toast(message, type = 'info', ms = 7000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = { error: 'X', ok: 'OK', info: 'i' }[type] || 'i';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = icon;
  const text = document.createElement('span');
  text.className = 'msg';
  text.textContent = message;
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = 'x';
  close.addEventListener('click', () => el.remove());
  el.append(badge, text, close);
  toasts.append(el);
  setTimeout(() => el.remove(), ms);
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : 'ok';
}

function fail(msg) {
  setStatus(msg, true);
  toast(msg, 'error');
  dropzone.classList.add('shake');
  setTimeout(() => dropzone.classList.remove('shake'), 600);
}

function log(title, data) {
  logEl.textContent = `${title}\n${new Date().toLocaleTimeString()}\n\n${data}`;
}

function fmtSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------- Validacion ----------
function validate(file) {
  if (!file) return 'Selecciona un archivo';
  if (!ALLOWED.includes(file.type)) {
    return `Tipo no permitido (${file.type || file.name.split('.').pop()}). Solo JPG, PNG o WEBP`;
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `Archivo demasiado grande (${fmtSize(file.size)}). El maximo es ${MAX_SIZE_MB} MB`;
  }
  return null;
}

function showFileInfo() {
  const file = fileInput.files[0];
  fileInfo.textContent = file ? `Seleccionado: ${file.name} (${fmtSize(file.size)}, ${file.type || 'tipo desconocido'})` : '';
  const problem = file ? validate(file) : null;
  fileInfo.className = problem ? 'error' : '';
}
fileInput.addEventListener('change', showFileInfo);

// Drag and drop
['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault();
  dropzone.classList.add('over');
}));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault();
  dropzone.classList.remove('over');
}));
dropzone.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    showFileInfo();
  }
});

// ---------- Subida ----------
document.getElementById('uploadBtn').addEventListener('click', async () => {
  const file = fileInput.files[0];
  const problem = validate(file);
  if (problem) return fail(problem);

  try {
    setStatus('Pidiendo URL de carga al backend...');
    // 1) Pedir presigned URL al backend
    const res = await fetch(`${API}/api/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size
      })
    });
    const data = await res.json();
    if (!res.ok) return fail(`Backend: ${data.error || 'Error del servidor'}`);

    // 2) PUT directo a S3 (el navegador habla con S3, no con el backend)
    const s3Host = new URL(data.uploadUrl).host;
    setStatus(`Subiendo directo a S3 (${s3Host})...`);
    const put = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        'x-amz-server-side-encryption': 'AES256'
      },
      body: file
    });
    if (!put.ok) return fail(`S3 rechazo la carga (HTTP ${put.status})`);

    log('PUT directo a S3', `Destino: ${s3Host}\nClave: ${data.key}\nRespuesta: HTTP ${put.status}\nEl archivo NO paso por el backend.`);
    setStatus('Subida completa');
    toast(`Imagen subida correctamente directo a S3 (${s3Host})`, 'ok');
    fileInput.value = '';
    fileInfo.textContent = '';
    loadGallery();
  } catch (err) {
    console.error(err);
    fail('Error de red al subir la imagen (revisa CORS y que el backend este activo)');
  }
});

// ---------- Galeria ----------
function startCountdown(el, loadedAt) {
  const tick = () => {
    const left = VIEW_SECONDS - Math.floor((Date.now() - loadedAt) / 1000);
    if (left <= 0) {
      el.textContent = 'URL expirada';
      el.className = 'timer expired';
      return;
    }
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    el.textContent = `URL expira en ${m}:${s}`;
    el.className = 'timer';
    setTimeout(tick, 1000);
  };
  tick();
}

async function loadGallery() {
  try {
    const res = await fetch(`${API}/api/images`);
    const items = await res.json();
    if (!res.ok) return fail(items.error || 'Error al listar');

    const loadedAt = Date.now();
    gallery.replaceChildren();
    if (!items.length) {
      gallery.textContent = 'Aun no hay imagenes.';
      return;
    }
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';

      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.key;

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = item.key.replace('originales/', '');

      const timer = document.createElement('div');
      startCountdown(timer, loadedAt);

      const btn = document.createElement('button');
      btn.textContent = 'Eliminar';
      btn.addEventListener('click', () => del(item.key));

      card.append(img, name, timer, btn);
      gallery.append(card);
    });
  } catch (err) {
    console.error(err);
    fail('No se pudo conectar con el backend');
  }
}

async function del(key) {
  if (!confirm('Eliminar esta imagen?')) return;
  const res = await fetch(`${API}/api/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!res.ok) return fail('No se pudo eliminar la imagen');
  setStatus('Imagen eliminada');
  toast('Imagen eliminada', 'ok');
  loadGallery();
}

// ---------- Panel de pruebas (backend directo) ----------
async function testBackend(label, body) {
  try {
    const res = await fetch(`${API}/api/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    log(`Prueba: ${label}`, `Solicitud: POST /api/upload-url\nCuerpo: ${JSON.stringify(body)}\n\nRespuesta: HTTP ${res.status}\n${JSON.stringify(data, null, 2)}`);
    if (res.ok) toast(`${label}: el backend la acepto (HTTP ${res.status})`, 'info');
    else toast(`Backend rechazo (HTTP ${res.status}): ${data.error}`, 'error');
  } catch (err) {
    fail('No se pudo conectar con el backend');
  }
}

document.getElementById('testBig').addEventListener('click', () =>
  testBackend('Archivo de 10 MB', { filename: 'grande.jpg', contentType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 }));
document.getElementById('testPdf').addEventListener('click', () =>
  testBackend('Tipo PDF', { filename: 'documento.pdf', contentType: 'application/pdf', sizeBytes: 50000 }));

loadGallery();
