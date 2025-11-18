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

/* === CLEAR file selections === */
$('#clearLogo').addEventListener('click', () => {
  $('#logoInput').value = '';
  if (currentConfig) currentConfig.logo = DEFAULT_LOGO;
});
$('#clearBg').addEventListener('click', () => {
  $('#bgInput').value = '';
  if (currentConfig) currentConfig.slides = DEFAULT_SLIDES.slice();
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

/* PLAY → collect data, stash, switch to player */
$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();

  /* timings in ms (fallback 30 s / 16 s) */
  const bgMs  = 1000 * ($('#bgSeconds').valueAsNumber || 30);
  const cueMs = 1000 * ($('#cueSeconds').valueAsNumber || 16);

  const prev = currentConfig || {};

  const program = [...document.querySelectorAll('.progRow')]
    .filter(r => r.querySelector('.progTitle').value.trim())
    .map(r => ({
      time : r.querySelector('.progTime').value || '--:--',
      title: r.querySelector('.progTitle').value.trim()
    }));

  const data = {
    /* assets & strings */
    logo   : prev.logo || DEFAULT_LOGO,
    title  : $('#toggleTitle').checked ? $('#eventName').value.trim() : '',
    ssid   : $('#ssid').value.trim(),
    pw     : $('#wifiPw').value.trim(),
    program,
    rem1   : $('#line1').value.trim(),
    rem2   : $('#line2').value.trim(),
    slides : Array.isArray(prev.slides) && prev.slides.length ? prev.slides.slice() : [],

    /* per-cue toggles */
    showLogo   : $('#toggleLogo').checked,
    showTitle  : $('#toggleTitle').checked,
    showWifi   : $('#toggleWifi').checked,
    showProgram: $('#toggleProgram').checked,
    showRem1   : $('#toggleRem1').checked,
    showRem2   : $('#toggleRem2').checked,

    /* timings */
    bgMs,
    cueMs
  };

  // override logo if a new file is chosen
  const logoFile = $('#logoInput').files[0];
  if (logoFile) {
    data.logo = await fileToDataURL(logoFile);
  }

  // override slides if new background files are chosen
  const bgFiles = $('#bgInput').files;
  if (bgFiles && bgFiles.length) {
    data.slides = await filesToArray(bgFiles);
  }

  if (!data.slides || data.slides.length === 0) {
    data.slides = DEFAULT_SLIDES.slice();
  }

  // local auto-resume
  sessionStorage.setItem('eventData', JSON.stringify(data));

  // 🔗 update URL so it encodes this configuration
  updateUrlWithConfig(data);

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
    <span class="wifi-label">NETWORK:</span><span class="wifi-val">${d.ssid}</span>
    <span class="wifi-label">PASSWORD:</span><span class="wifi-val">${d.pw}</span>`;

  $('#programBlock').innerHTML =
    `<span class="program-heading">PROGRAM</span>` +
    d.program.map(p => `
      <span class="prog-time">${p.time}</span><span class="prog-title">${p.title}</span>`
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

document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;

  // 1) If URL hash contains config (#cfg=...), use that and start player
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
