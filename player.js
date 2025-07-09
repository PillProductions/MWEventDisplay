const $ = sel => document.querySelector(sel);

const DURATION = 8000;
const FADE_BUFFER = 500;

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
    `JOIN OUR WI-FI<br/>NETWORK: <span style="color:#FFC600">${d.ssid}</span><br/>`+
    `PASSWORD: <span style="color:#FFC600">${d.pw}</span>`;
  $('#programBlock').textContent = d.program;
  $('#rem1').textContent = d.rem1;
  $('#rem2').textContent = d.rem2;

  const bg = $('#bgContainer');
  d.slides.forEach((src,i)=>{
    const img = new Image();
    img.src = src;
    img.style.animationDelay = `${i*7.5}s`;
    bg.appendChild(img);
  });

  const cues = ['#logo','#title','#wifi','#programBlock','#rem1','#rem2']
    .map(sel=>$(sel))
    .filter(el=>el && (el.textContent.trim()!=='' || (el.tagName==='IMG' && el.src)));

  (async function loop(){
    for(const el of cues){
      el.style.animation = `fadeZoom ${DURATION}ms ease-in-out forwards`;
      await sleep(DURATION - FADE_BUFFER);
      el.style.animation = '';
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
