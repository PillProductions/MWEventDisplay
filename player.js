/* =====================================================================
   UTILITY
   ===================================================================== */
const $ = sel => document.querySelector(sel);

/* global handles so we can cancel on re-start */
let bgInterval = null;
let cueToken   = 0;          // increments every time startPlayer() runs
let currentConfig = null;    // last used config (for editing / replays)

const DEFAULT_LOGO   = 'defaults/logo.png';
const DEFAULT_SLIDES = ['defaults/bg-01.jpg', 'defaults/bg-02.jpg'];

/* Backend lives next to the static site under /api (Azure Static Web Apps). */
const API_BASE = '/api';

/* Strip inline data: URLs out of a config before uploading — the raw bytes
   travel in the separate `images` object so we never send them twice. */
function stripImagesForUpload(config) {
  const c = { ...config };
  if (typeof c.logo === 'string' && c.logo.startsWith('data:')) delete c.logo;
  if (Array.isArray(c.slides)) {
    c.slides = c.slides.filter(s => typeof s === 'string' && !s.startsWith('data:'));
  }
  return c;
}

/* POST config + image bytes, receive a short, shareable id. */
async function saveToServer(config, images) {
  const payload = { config: stripImagesForUpload(config), images };

  const doPost = key => fetch(`${API_BASE}/save`, {
    method : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-upload-key': key } : {})
    },
    body   : JSON.stringify(payload)
  });

  let key = localStorage.getItem('uploadKey') || '';
  let res = await doPost(key);

  // If the deployment requires an upload key, ask for it once and retry.
  if (res.status === 401) {
    key = (prompt('Enter the upload key for this screen system:') || '').trim();
    if (key) {
      localStorage.setItem('uploadKey', key);
      res = await doPost(key);
    }
  }

  if (!res.ok) {
    if (res.status === 401) localStorage.removeItem('uploadKey'); // wrong key, forget it
    let msg = `Server error (${res.status})`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  const { id } = await res.json();
  return id;
}

/* Fetch the canonical, server-stored config for an id. */
async function fetchConfig(id) {
  const res = await fetch(`${API_BASE}/config/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Could not load event (${res.status})`);
  return res.json();
}

/* Put a short `#id=...` into the address bar (the copyable share link). */
function setUrlId(id) {
  const url = new URL(window.location.href);
  url.hash = 'id=' + id;
  window.history.replaceState(null, '', url.toString());
}

/* =====================================================================
   IMAGE GALLERY STATE  (logo + reorderable background slides)
   ---------------------------------------------------------------------
   Each item: { id, kind, src, name }
     kind 'default' → bundled file   (src = 'defaults/…')
     kind 'asset'   → uploaded asset  (src = '/api/asset/…')
     kind 'file'    → freshly picked  (src = data: URL, name = filename)
   ===================================================================== */
let logoState  = null;   // single item, or null = use default logo
let slideState = [];     // ordered array of items

const uid = () => Math.random().toString(36).slice(2, 9);

function refToItem(src, name = '') {
  if (!src) return null;
  const kind = src.startsWith('/api/asset/') ? 'asset'
             : src.startsWith('data:')       ? 'file'
             : 'default';
  return { id: uid(), kind, src, name };
}

/* ---- LOGO preview ---- */
function renderLogoPreview() {
  const wrap = $('#logoPreview');
  if (!wrap) return;
  wrap.innerHTML = '';

  const isDefault = !logoState;
  const src   = isDefault ? DEFAULT_LOGO : logoState.src;
  const label = isDefault ? 'Default logo'
              : (logoState.name || (logoState.kind === 'asset' ? 'Uploaded logo' : 'Selected logo'));

  const thumb = document.createElement('div');
  thumb.className = 'logo-thumb';
  const img = document.createElement('img');
  img.src = src; img.alt = '';
  thumb.appendChild(img);

  const info = document.createElement('div');
  info.className = 'logo-info';
  const name = document.createElement('span');
  name.className = 'logo-name' + (isDefault ? '' : ' has-file');
  name.textContent = label;
  const hint = document.createElement('span');
  hint.className = 'dropzone-hint';
  hint.textContent = 'PNG or JPEG';
  info.append(name, hint);

  const actions = document.createElement('div');
  actions.className = 'logo-actions';
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'ghost-btn';
  change.textContent = 'Change';
  change.addEventListener('click', () => $('#logoInput').click());
  actions.appendChild(change);
  if (!isDefault) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'ghost-btn danger';
    reset.textContent = 'Use default';
    reset.addEventListener('click', () => { logoState = null; renderLogoPreview(); });
    actions.appendChild(reset);
  }

  wrap.append(thumb, info, actions);
}

$('#logoInput').addEventListener('change', async () => {
  const file = $('#logoInput').files[0];
  if (!file) return;
  const src = await fileToDataURL(file);
  logoState = { id: uid(), kind: 'file', src, name: file.name };
  $('#logoInput').value = '';   // allow re-picking the same file later
  renderLogoPreview();
});

/* ---- SLIDE gallery ---- */
function updateSlideCount() {
  const el = $('#slideCount');
  if (el) el.textContent = slideState.length ? `${slideState.length} selected` : '';
}

function renderSlideGallery() {
  const g = $('#slideGallery');
  if (!g) return;
  g.innerHTML = '';

  slideState.forEach((item, i) => {
    const tile = document.createElement('div');
    tile.className = 'slide-tile';
    tile.draggable = true;
    tile.dataset.index = i;

    const thumb = document.createElement('div');
    thumb.className = 'slide-thumb';
    const img = document.createElement('img');
    img.src = item.src; img.alt = '';
    img.loading = 'lazy';
    thumb.appendChild(img);

    const tools = document.createElement('div');
    tools.className = 'tile-tools';
    const mk = (cls, txt, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tile-btn ' + cls;
      b.textContent = txt; b.title = title;
      b.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
      return b;
    };
    tools.append(
      mk('move-left',  '◀', 'Move left',  () => moveSlide(i, i - 1)),
      mk('tile-remove','✕', 'Remove',     () => { slideState.splice(i, 1); renderSlideGallery(); }),
      mk('move-right', '▶', 'Move right', () => moveSlide(i, i + 1))
    );

    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.textContent = i + 1;

    tile.append(thumb, tools, badge);
    g.appendChild(tile);
  });

  // "Add" tile
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'slide-tile add-tile';
  add.innerHTML = '<span class="add-plus">+</span><span class="add-label">Add images</span>';
  add.addEventListener('click', () => $('#bgInput').click());
  g.appendChild(add);

  updateSlideCount();
}

function moveSlide(from, to) {
  if (to < 0 || to >= slideState.length) return;
  const [it] = slideState.splice(from, 1);
  slideState.splice(to, 0, it);
  renderSlideGallery();
}

/* drag-and-drop reordering (delegated on the gallery) */
let dragFrom = null;
$('#slideGallery').addEventListener('dragstart', e => {
  const tile = e.target.closest('.slide-tile:not(.add-tile)');
  if (!tile) return;
  dragFrom = Number(tile.dataset.index);
  tile.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('#slideGallery').addEventListener('dragend', e => {
  const tile = e.target.closest('.slide-tile');
  if (tile) tile.classList.remove('dragging');
  dragFrom = null;
});
$('#slideGallery').addEventListener('dragover', e => {
  if (dragFrom === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
$('#slideGallery').addEventListener('drop', e => {
  if (dragFrom === null) return;
  e.preventDefault();
  const tile = e.target.closest('.slide-tile:not(.add-tile)');
  const to = tile ? Number(tile.dataset.index) : slideState.length - 1;
  if (to !== dragFrom) moveSlide(dragFrom, to);
  dragFrom = null;
});

$('#bgInput').addEventListener('change', async () => {
  const files = [...$('#bgInput').files];
  if (!files.length) return;
  for (const f of files) {
    const src = await fileToDataURL(f);
    slideState.push({ id: uid(), kind: 'file', src, name: f.name });
  }
  $('#bgInput').value = '';
  renderSlideGallery();
});

/* add bundled default slides (skip ones already present) */
$('#addDefaultsBtn').addEventListener('click', () => {
  DEFAULT_SLIDES.forEach(src => {
    if (!slideState.some(it => it.src === src)) {
      slideState.push({ id: uid(), kind: 'default', src, name: '' });
    }
  });
  renderSlideGallery();
});



/* =====================================================================
   1.  SETUP-PAGE HELPERS
   ===================================================================== */

/* add a programme row */
$('#addRow').addEventListener('click', () => {
  $('#programList').insertAdjacentHTML('beforeend', `
    <div class="progRow">
      <input type="time"  class="progTime">
      <input type="text"  class="progTitle" placeholder="Agenda item">
      <button type="button" class="removeRow">✕</button>
    </div>`);
});

/* remove a programme row */
$('#programList').addEventListener('click', e => {
  if (e.target.classList.contains('removeRow')) e.target.parentElement.remove();
});

/* Read the entire setup form (+ gallery state) into a config object.
   Logo/slides are stored as references or data: URLs, NOT uploaded here. */
function collectConfig() {
  const program = [...document.querySelectorAll('.progRow')]
    .filter(r => r.querySelector('.progTitle').value.trim())
    .map(r => ({
      time : r.querySelector('.progTime').value || '--:--',
      title: r.querySelector('.progTitle').value.trim()
    }));

  let slides = slideState.map(it => it.src);
  if (slides.length === 0) slides = DEFAULT_SLIDES.slice();

  return {
    logo   : logoState ? logoState.src : DEFAULT_LOGO,
    title  : $('#eventName').value.trim(),
    ssid   : $('#ssid').value.trim(),
    pw     : $('#wifiPw').value.trim(),
    program,
    rem1   : $('#line1').value.trim(),
    rem2   : $('#line2').value.trim(),
    slides,

    showLogo   : $('#toggleLogo').checked,
    showTitle  : $('#toggleTitle').checked,
    showWifi   : $('#toggleWifi').checked,
    showProgram: $('#toggleProgram').checked,
    showRem1   : $('#toggleRem1').checked,
    showRem2   : $('#toggleRem2').checked,

    bgMs : 1000 * ($('#bgSeconds').valueAsNumber  || 30),
    cueMs: 1000 * ($('#cueSeconds').valueAsNumber || 16)
  };
}

/* PLAY → collect data, stash, switch to player */
$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();

  let data = collectConfig();

  // Detect uploads from the gallery state model.
  const hasLogoUpload  = logoState && logoState.kind === 'file';
  const hasSlideUpload = slideState.some(it => it.kind === 'file');
  const hasUploads     = hasLogoUpload || hasSlideUpload;

  // Ordered slide payload: data URLs (new) + refs (defaults/assets), in order.
  const orderedSlides = data.slides.slice();

  try {
    if (hasUploads) {
      // Heavy bytes go to the server, which validates + re-encodes them and
      // returns a tiny id. The share link stays short.
      data.logo   = DEFAULT_LOGO;   // server overwrites from images.logo
      data.slides = [];             // server rebuilds from images.slides (ordered)
      const id = await saveToServer(data, {
        logo  : logoState ? logoState.src : undefined,
        slides: orderedSlides
      });
      // Re-fetch so the local player uses the exact same config (with
      // /api/asset URLs) that every TV will load.
      data = await fetchConfig(id);
      setUrlId(id);
    } else {
      // No uploads → keep the zero-dependency base64-in-URL flow.
      // data.logo / data.slides already hold the right references.
      updateUrlWithConfig(data);
    }
  } catch (err) {
    console.error('Save failed:', err);
    alert('Could not save the event: ' + err.message);
    return;
  }

  // local auto-resume
  sessionStorage.setItem('eventData', JSON.stringify(data));

  currentConfig = data;

  // switch to player view
  $('#setup').classList.add('hidden');
  $('#player').classList.remove('hidden');

  startPlayer(data);
});

/* =====================================================================
   1b. TEXT FITTING HELPERS
   ===================================================================== */

function fitText(el, maxVw, minVw = 2) {
  if (!el) return;
  let size = maxVw;
  el.style.fontSize = size + 'vw';

  const maxW = window.innerWidth * 0.9;
  const maxH = window.innerHeight * 0.8;

  while (
    size > minVw &&
    (el.scrollWidth > maxW || el.scrollHeight > maxH)
  ) {
    size -= 0.5;
    el.style.fontSize = size + 'vw';
  }
}

function fitToWidth(el, maxFraction = 0.6, maxVw = 5.5, minVw = 1.5) {
  if (!el) return;
  const maxW = window.innerWidth * maxFraction;
  let size   = maxVw;
  el.style.fontSize = size + 'vw';

  // shrink in 0.25-vw steps until the block fits the width cap
  while (size > minVw && el.scrollWidth > maxW) {
    size -= 0.25;
    el.style.fontSize = size + 'vw';
  }
}

/* =====================================================================
   2.  PLAYER LOGIC
   ===================================================================== */
function startPlayer(d) {
  currentConfig = d;

  /* —— 1) stop anything still running —— */
  if (bgInterval) clearInterval(bgInterval);
  cueToken += 1;               // invalidate old cue loops
  resetCueAnimations();

  /* —— 2) populate the stage —— */
  $('#logo').src          = d.logo;
  $('#title').textContent = d.title;

  $('#wifi').innerHTML = `
    <div class="wifi-heading">JOIN OUR WI-FI</div>
    <span class="wifi-label">NETWORK:</span><span class="wifi-val">${escapeHtml(d.ssid)}</span>
    <span class="wifi-label">PASSWORD:</span><span class="wifi-val">${escapeHtml(d.pw)}</span>`;

  $('#programBlock').innerHTML =
    `<span class="program-heading">PROGRAM</span>` +
    d.program.map(p => `
      <span class="prog-time">${escapeHtml(p.time)}</span><span class="prog-title">${escapeHtml(p.title)}</span>`
    ).join('');

  $('#rem1').textContent = d.rem1;
  $('#rem2').textContent = d.rem2;

  /* —— 2b) apply text fitting —— */
  fitText($('#title'), 6);           // event name
  fitText($('#rem1'),  3.5);
  fitText($('#rem2'),  3.5);
  fitText($('#programBlock'), 3.5);  // handles many rows
  fitToWidth($('#programBlock'), 0.6, 3.5);   // 60 % viewport cap

  /* —— 3) start background slideshow —— */
  initBackground(d.slides, d.bgMs);

  /* —— 4) build cue list & run fade/zoom loop —— */
  const cues = [
    { el: $('#logo'),         ok: d.showLogo    && $('#logo').src },
    { el: $('#title'),        ok: d.showTitle   && $('#title').textContent },
    { el: $('#wifi'),         ok: d.showWifi    && $('#wifi').textContent },
    { el: $('#programBlock'), ok: d.showProgram && d.program.length },
    { el: $('#rem1'),         ok: d.showRem1    && $('#rem1').textContent },
    { el: $('#rem2'),         ok: d.showRem2    && $('#rem2').textContent }
  ].filter(c => c.ok).map(c => c.el);

  runCueLoop(cues, cueToken, d.cueMs);
}

/* —— background Ken-Burns slideshow —— */
function initBackground(slides, BG_DURATION) {
  /* wipe any old imgs & animations */
  $('#bgContainer').innerHTML = '';

  const bg   = $('#bgContainer');
  const imgA = new Image(), imgB = new Image();
  imgA.className = 'bgSlide bgA';
  imgB.className = 'bgSlide bgB';
  bg.append(imgA, imgB);

  let current = imgA, idx = 0;

  const swap = () => {
    const nextIdx = (idx + 1) % slides.length;
    const nextImg = current === imgA ? imgB : imgA;

    nextImg.src             = slides[nextIdx];
    nextImg.classList.add('active');
    nextImg.style.animation = `kenburns ${BG_DURATION}ms ease-in-out`;

    current.classList.remove('active');
    current.style.animation = 'none';

    current = nextImg;
    idx     = nextIdx;
  };

  imgA.src = slides[0];
  imgA.classList.add('active');
  imgA.style.animation = `kenburns ${BG_DURATION}ms ease-in-out`;

  bgInterval = setInterval(swap, BG_DURATION);
}

/* —— cue fade/zoom loop —— */
async function runCueLoop(cues, myToken, CUE_DURATION) {
  while (myToken === cueToken) {
    for (const el of cues) {
      el.style.animation = `fadeZoom ${CUE_DURATION}ms ease-in-out forwards`;
      await sleep(CUE_DURATION);
      if (myToken !== cueToken) return;   // aborted by new run
      el.style.animation = 'none';
      void el.offsetWidth;                // force reflow
    }
  }
}

/* —— clear animations & opacity —— */
function resetCueAnimations() {
  document.querySelectorAll('.cue').forEach(el => {
    el.style.animation = 'none';
    el.style.opacity   = 0;
  });
}

/* =====================================================================
   3.  TOOLS
   ===================================================================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fileToDataURL(file) {
  return new Promise(res => {
    if (!file) { res(null); return; }
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.readAsDataURL(file);
  });
}

async function filesToArray(list) {
  const out = [];
  for (const f of list) out.push(await fileToDataURL(f));
  return out;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* --- CONFIG ENCODING HELPERS (URL <-> object) --- */

/**
 * Encode configuration object into a URL-safe string.
 * Uses JSON + encodeURIComponent so Unicode (Danish, etc.) is preserved.
 */
function encodeConfig(obj) {
  try {
    const json = JSON.stringify(obj);
    // encodeURIComponent → safe UTF‑8, then btoa to base64
    return btoa(encodeURIComponent(json));
  } catch (err) {
    console.warn('encodeConfig failed:', err);
    return '';
  }
}

function decodeConfig(str) {
  const json = decodeURIComponent(atob(str));
  return JSON.parse(json);
}


/**
 * Put the current configuration into the ?cfg=... query parameter
 * so you can copy/paste the URL and get the same player state.
 */
function updateUrlWithConfig(data) {
  try {
    const encoded = encodeConfig(data);
    if (!encoded) return;
    const url = new URL(window.location.href);
    url.hash = 'cfg=' + encoded;       // goes into #..., not ?...
    window.history.replaceState(null, '', url.toString());
  } catch (err) {
    console.warn('updateUrlWithConfig failed:', err);
  }
}



/* =====================================================================
   4.  NAVIGATION (⚙️ button & auto-resume / URL-boot)
   ===================================================================== */

$('#editBtn').addEventListener('click', () => {
  if (currentConfig) {
    applyConfigToForm(currentConfig);
  }
  $('#player').classList.add('hidden');
  $('#setup').classList.remove('hidden');
});

document.addEventListener('DOMContentLoaded', async () => {
  const hash = window.location.hash;

  // Initial render of the (empty) galleries so the setup form looks complete.
  renderLogoPreview();
  renderSlideGallery();

  // 1a) Short server id (#id=...) → fetch config from the API and autoplay.
  if (hash && hash.startsWith('#id=')) {
    const id = hash.slice(4);
    try {
      const data = await fetchConfig(id);
      sessionStorage.setItem('eventData', JSON.stringify(data));
      $('#setup').classList.add('hidden');
      $('#player').classList.remove('hidden');
      startPlayer(data);
      return;
    } catch (err) {
      console.warn('Could not load config from id:', err);
      // fall through to other boot paths
    }
  }

  // 1b) Inline config (#cfg=...) → decode locally and autoplay (no server).
  if (hash && hash.startsWith('#cfg=')) {
    const encoded = hash.slice(5); // remove "#cfg="
    try {
      const data = decodeConfig(encoded);
      sessionStorage.setItem('eventData', JSON.stringify(data)); // keep in sync
      $('#setup').classList.add('hidden');
      $('#player').classList.remove('hidden');
      startPlayer(data);
      return; // don't fall through to sessionStorage logic
    } catch (err) {
      console.warn('Could not read config from URL hash:', err);
      // fall through to sessionStorage handling
    }
  }

  // 2) Otherwise, auto-resume from last session if available
  const saved = sessionStorage.getItem('eventData');
  if (saved) {
    const data = JSON.parse(saved);
    $('#setup').classList.add('hidden');
    $('#player').classList.remove('hidden');
    startPlayer(data);
  }
});


/* Copy-share-URL button */
const copyBtn = $('#copyUrlBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const urlToSave = window.location.href;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(urlToSave);
        alert('Link copied to clipboard');
      } else {
        const blob = new Blob([urlToSave], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'event-screen-url.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
    } catch (err) {
      console.warn('Copy to clipboard failed, saving as file instead:', err);
      const blob = new Blob([urlToSave], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'event-screen-url.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }
  });
}

/* ==== FULL-SCREEN TOGGLE ==== */
$('#fsBtn').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen request failed:', err);
  }
});

/* =====================================================================
   5.  APPLY CONFIG TO SETUP FORM
   ===================================================================== */
function applyConfigToForm(d) {
  if (!d) return;

  // toggles
  $('#toggleLogo').checked    = d.showLogo    !== undefined ? d.showLogo    : true;
  $('#toggleTitle').checked   = d.showTitle   !== undefined ? d.showTitle   : true;
  $('#toggleWifi').checked    = d.showWifi    !== undefined ? d.showWifi    : true;
  $('#toggleProgram').checked = d.showProgram !== undefined ? d.showProgram : true;
  $('#toggleRem1').checked    = d.showRem1    !== undefined ? d.showRem1    : true;
  $('#toggleRem2').checked    = d.showRem2    !== undefined ? d.showRem2    : true;

  // basic text inputs
  $('#eventName').value = d.title || '';
  $('#ssid').value      = d.ssid  || '';
  $('#wifiPw').value    = d.pw    || '';
  $('#line1').value     = d.rem1  || '';
  $('#line2').value     = d.rem2  || '';

  // timings (ms -> seconds)
  if (d.bgMs)  $('#bgSeconds').value  = Math.round(d.bgMs  / 1000);
  if (d.cueMs) $('#cueSeconds').value = Math.round(d.cueMs / 1000);

  // image galleries (logo + slides)
  logoState = (d.logo && d.logo !== DEFAULT_LOGO) ? refToItem(d.logo) : null;
  slideState = Array.isArray(d.slides) ? d.slides.map(s => refToItem(s)).filter(Boolean) : [];
  renderLogoPreview();
  renderSlideGallery();

  // programme list
  const list = $('#programList');
  if (!list) return;

  list.innerHTML = '';

  if (Array.isArray(d.program) && d.program.length) {
    d.program.forEach(p => {
      const time  = p.time  || '';
      const title = p.title || '';
      list.insertAdjacentHTML('beforeend', `
        <div class="progRow">
          <input type="time"  class="progTime"  value="${escapeHtml(time)}">
          <input type="text"  class="progTitle" placeholder="Agenda item" value="${escapeHtml(title)}">
          <button type="button" class="removeRow">✕</button>
        </div>`);
    });
  } else {
    // at least one empty row
    list.insertAdjacentHTML('beforeend', `
      <div class="progRow">
        <input type="time"  class="progTime">
        <input type="text"  class="progTitle" placeholder="Agenda item">
        <button type="button" class="removeRow">✕</button>
      </div>`);
  }
}


/* =====================================================================
   6.  TEMPLATES  (saved setups in localStorage, reloadable from setup)
   ===================================================================== */
const TEMPLATES_KEY = 'eventTemplates';

function loadTemplates() {
  try {
    const arr = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistTemplates(list) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}

function renderTemplateBar() {
  const bar = $('#templateBar');
  const sel = $('#templateSelect');
  if (!bar || !sel) return;

  const templates = loadTemplates();
  bar.classList.toggle('hidden', templates.length === 0);

  sel.innerHTML = '';
  templates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
}

/* ---- Save flow (inline name editor) ---- */
$('#saveTemplateBtn').addEventListener('click', () => {
  $('#templateSaveRow').classList.remove('hidden');
  const input = $('#templateName');
  input.value = $('#eventName').value.trim() || 'My event';
  input.focus();
  input.select();
});

$('#cancelSaveTemplate').addEventListener('click', () => {
  $('#templateSaveRow').classList.add('hidden');
});

function saveCurrentAsTemplate() {
  const name = $('#templateName').value.trim();
  if (!name) { $('#templateName').focus(); return; }

  const templates = loadTemplates();
  const config = collectConfig();
  const existing = templates.find(t => t.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    existing.config = config;
    existing.savedAt = Date.now();
  } else {
    templates.push({ id: uid(), name, savedAt: Date.now(), config });
  }

  try {
    persistTemplates(templates);
  } catch (err) {
    // localStorage quota — most likely large embedded images not yet uploaded.
    console.warn('Template save failed:', err);
    alert(
      'Could not save template — the selected images are too large to store ' +
      'locally. Tip: press Play once first so images upload and become ' +
      'lightweight links, then save the template.'
    );
    return;
  }

  $('#templateSaveRow').classList.add('hidden');
  renderTemplateBar();
  $('#templateSelect').value = (existing ? existing.id : templates[templates.length - 1].id);
}

$('#confirmSaveTemplate').addEventListener('click', saveCurrentAsTemplate);
$('#templateName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveCurrentAsTemplate(); }
  if (e.key === 'Escape') $('#templateSaveRow').classList.add('hidden');
});

/* ---- Load / delete ---- */
$('#loadTemplateBtn').addEventListener('click', () => {
  const id = $('#templateSelect').value;
  const t = loadTemplates().find(x => x.id === id);
  if (!t) return;
  applyConfigToForm(t.config);
});

$('#deleteTemplateBtn').addEventListener('click', () => {
  const id = $('#templateSelect').value;
  const templates = loadTemplates();
  const t = templates.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Delete template “${t.name}”?`)) return;
  persistTemplates(templates.filter(x => x.id !== id));
  renderTemplateBar();
});

/* initial render */
renderTemplateBar();

