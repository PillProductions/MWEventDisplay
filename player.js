/* =====================================================================
   UTILITY
   ===================================================================== */
   const $ = sel => document.querySelector(sel);

   /* global handles so we can cancel on re-start */
   let bgInterval = null;
   let cueToken   = 0;          // increments every time startPlayer() runs
   
   /* === CLEAR file selections === */
   $('#clearLogo').addEventListener('click', () => $('#logoInput').value = '');
   $('#clearBg'  ).addEventListener('click', () => $('#bgInput').value  = '');
   
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
   
     /* timings in ms (fallback 15 s / 8 s) */
     const bgMs  = 1000 * ($('#bgSeconds').valueAsNumber || 15);
     const cueMs = 1000 * ($('#cueSeconds').valueAsNumber || 8);
   
     const data = {
       /* assets & strings */
       logo : await fileToDataURL($('#logoInput').files[0]) || 'defaults/logo.png',
       title: $('#toggleTitle').checked ? $('#eventName').value.trim() : '',
       ssid : $('#ssid').value.trim(),
       pw   : $('#wifiPw').value.trim(),
       program: [...document.querySelectorAll('.progRow')]
         .filter(r => r.querySelector('.progTitle').value.trim())
         .map(r => ({
           time : r.querySelector('.progTime').value || '--:--',
           title: r.querySelector('.progTitle').value.trim()
         })),
       rem1 : $('#line1').value.trim(),
       rem2 : $('#line2').value.trim(),
       slides: await filesToArray($('#bgInput').files),
   
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
   
     if (data.slides.length === 0) {
       data.slides = ['defaults/bg-01.jpg', 'defaults/bg-02.jpg'];
     }
   
     sessionStorage.setItem('eventData', JSON.stringify(data));
   
     $('#setup').classList.add('hidden');
     $('#player').classList.remove('hidden');
     startPlayer(data);
   });
   
   /* =====================================================================
      2.  PLAYER LOGIC
      ===================================================================== */
   function startPlayer(d) {
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
   
     /* —— 3) start background slideshow —— */
     initBackground(d.slides, d.bgMs);
   
     /* —— 4) build cue list & run fade/zoom loop —— */
     const cues = [
       { el: $('#logo'),         ok: d.showLogo   && $('#logo').src },
       { el: $('#title'),        ok: d.showTitle  && $('#title').textContent },
       { el: $('#wifi'),         ok: d.showWifi   && $('#wifi').textContent },
       { el: $('#programBlock'), ok: d.showProgram && d.program.length },
       { el: $('#rem1'),         ok: d.showRem1   && $('#rem1').textContent },
       { el: $('#rem2'),         ok: d.showRem2   && $('#rem2').textContent }
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
   
       nextImg.src            = slides[nextIdx];
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
   
   /* =====================================================================
      4.  NAVIGATION (⚙️ button & auto-resume)
      ===================================================================== */
   $('#editBtn').addEventListener('click', () => {
     $('#player').classList.add('hidden');
     $('#setup').classList.remove('hidden');
   });
   
   document.addEventListener('DOMContentLoaded', () => {
     const saved = sessionStorage.getItem('eventData');
     if (saved) {
       $('#setup').classList.add('hidden');
       $('#player').classList.remove('hidden');
       startPlayer(JSON.parse(saved));
     }
   });
   