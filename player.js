const $ = sel => document.querySelector(sel);

const DURATION = 8000;
const BG_DURATION = 15000;

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    logo: await fileToDataURL($('#logoInput').files[0]) || 'defaults/logo.png',
    title: $('#eventName').value.trim(),
    ssid: $('#ssid').value.trim(),
    pw: $('#wifiPw').value.trim(),
    program: $('#program').value.trim(),
    rem1: $('#line1').value.trim(),
    rem2: $('#line2').value.trim(),
    slides: await filesToArray($('#bgInput').files)
  };
  if(data.slides.length === 0){
    data.slides = ['defaults/bg-01.jpg','defaults/bg-02.jpg'];
  }
  sessionStorage.setItem('eventData', JSON.stringify(data));
  $('#setup').classList.add('hidden');
  $('#player').classList.remove('hidden');
  startPlayer(data);
});

function startPlayer(d){
  $('#logo').src = d.logo;
  $('#title').textContent = d.title;
  $('#wifi').innerHTML =
    `JOIN OUR WI-FI<br/>NETWORK: <span class="wifi-val">${d.ssid}</span><br/>` +
    `PASSWORD: <span class="wifi-val">${d.pw}</span>`;
  $('#programBlock').textContent = d.program;
  $('#rem1').textContent = d.rem1;
  $('#rem2').textContent = d.rem2;

  const bg = $('#bgContainer');
  const imgA = new Image();
  const imgB = new Image();
  imgA.className = 'bgSlide';
  imgB.className = 'bgSlide';
  bg.appendChild(imgA);
  bg.appendChild(imgB);
  let currentImg = imgA;
  let idx = 0;
  const slides = d.slides;

  function showNext(){
    const nextIdx = (idx + 1) % slides.length;
    const nextImg = currentImg === imgA ? imgB : imgA;
    nextImg.src = slides[nextIdx];
    nextImg.classList.add('active');
    nextImg.style.animation = 'kenburns 15s ease-in-out';
    currentImg.classList.remove('active');
    currentImg.style.animation = 'none';
    currentImg = nextImg;
    idx = nextIdx;
  }

  imgA.src = slides[0];
  imgA.classList.add('active');
  imgA.style.animation = 'kenburns 15s ease-in-out';
  setInterval(showNext, BG_DURATION);

  const cues = ['#logo','#title','#wifi','#programBlock','#rem1','#rem2']
    .map(sel=>$(sel))
    .filter(el=>el && (el.textContent.trim()!=='' || (el.tagName==='IMG' && el.src)));

  (async function loop(){
    for(const el of cues){
      el.style.animation = `fadeZoom ${DURATION}ms ease-in-out forwards`;
      await sleep(DURATION);
      el.style.animation = 'none';
      void el.offsetWidth;
    }
    loop();
  })();
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function fileToDataURL(file){
  return new Promise(res=>{
    if(!file){res(null);return;}
    const reader=new FileReader();
    reader.onload=e=>res(e.target.result);
    reader.readAsDataURL(file);
  });
}
async function filesToArray(fileList){
  const arr=[];
  for(const f of fileList){
    arr.push(await fileToDataURL(f));
  }
  return arr;
}

document.addEventListener('DOMContentLoaded',()=>{
  const saved = sessionStorage.getItem('eventData');
  if(saved){
    $('#setup').classList.add('hidden');
    $('#player').classList.remove('hidden');
    startPlayer(JSON.parse(saved));
  }
});
