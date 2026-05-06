// script.js — Weather Dashboard main logic
// Uses Open-Meteo, RainViewer, and Pollenrapporten (Sweden)

const DEFAULT = { lat: 55.6050, lon: 13.0038, name: 'Malmö' };

let map, radarLayer, weatherCharts = {}, overlayCanvases = {}, allRadarFrames = [], radarPlayInterval = null, radarPlaying = false;
let latestWeatherData = null;
let resizeChartTimer = null;

function drawMidnightLines(chart, midnightIndices, chartName){
  if(!midnightIndices || midnightIndices.length === 0) return;
  const mainCanvas = chart.canvas;
  const mainCtx = mainCanvas.getContext('2d');
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  
  if(!xScale || !yScale) {
    return;
  }

  mainCtx.save();
  mainCtx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
  mainCtx.lineWidth = 1;
  mainCtx.setLineDash([4, 4]);
  
  midnightIndices.forEach(idx => {
    const xPos = xScale.getPixelForValue(idx);
    mainCtx.beginPath();
    mainCtx.moveTo(xPos, chart.chartArea.top);
    mainCtx.lineTo(xPos, chart.chartArea.bottom);
    mainCtx.stroke();
  });
  
  mainCtx.restore();
}

function ensureOverlayCanvas(chartCanvas, overlayId){
  const parent = chartCanvas.parentElement;
  if(!parent) return null;

  parent.style.position = 'relative';

  let overlay = document.getElementById(overlayId);
  if(!overlay){
    overlay = document.createElement('canvas');
    overlay.id = overlayId;
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2';
    parent.appendChild(overlay);
  }

  return overlay;
}

function drawMidnightOverlay(chart, midnightIndices, overlayId){
  if(!midnightIndices || midnightIndices.length === 0) return;
  const overlay = document.getElementById(overlayId);
  if(!overlay) return;

  overlay.width = chart.canvas.width;
  overlay.height = chart.canvas.height;

  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const xScale = chart.scales.x;
  if(!xScale) return;

  // Account for device pixel ratio
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);

  midnightIndices.forEach(idx => {
    const xPos = xScale.getPixelForValue(idx) * dpr;
    ctx.beginPath();
    ctx.moveTo(xPos, chart.chartArea.top * dpr);
    ctx.lineTo(xPos, chart.chartArea.bottom * dpr);
    ctx.stroke();
  });

  ctx.restore();
}

function drawCurrentHourLine(chart, currentHourIdx, chartName){
  if(currentHourIdx < 0) return;
  
  const mainCanvas = chart.canvas;
  const mainCtx = mainCanvas.getContext('2d');
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  
  if(!xScale || !yScale) {
    console.log('No scales available for current hour line');
    return;
  }
  
  console.log(`${chartName}: Drawing current hour line at index ${currentHourIdx}`);
  
  // Draw a blue/green line for current time
  mainCtx.save();
  mainCtx.strokeStyle = '#3b82f6';
  mainCtx.lineWidth = 2;
  mainCtx.globalAlpha = 0.8;
  mainCtx.globalCompositeOperation = 'source-over';
  mainCtx.setLineDash([5, 5]);
  
  const xPos = xScale.getPixelForValue(currentHourIdx);
  console.log(`${chartName}: currentHourIdx ${currentHourIdx} -> xPos: ${xPos}`);
  mainCtx.beginPath();
  mainCtx.moveTo(xPos, chart.chartArea.top);
  mainCtx.lineTo(xPos, chart.chartArea.bottom);
  mainCtx.stroke();
  
  mainCtx.restore();
}

// Chart.js plugin for vertical lines at midnight
const verticalMidnightPlugin = {
  id: 'verticalMidnightLines',
  afterDatasetsDraw(chart){
    const opts = chart.options.plugins?.verticalMidnightLines || {};
    const midnightIndices = opts.indices || [];
    if(!midnightIndices || midnightIndices.length === 0) return;
    
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if(!xScale || !yScale) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    midnightIndices.forEach(idx => {
      const xPos = xScale.getPixelForValue(idx);
      
      ctx.beginPath();
      ctx.moveTo(xPos, chart.chartArea.top);
      ctx.lineTo(xPos, chart.chartArea.bottom);
      ctx.stroke();
    });
    
    ctx.restore();
  }
};

if (typeof Chart !== 'undefined' && Chart.registerables) {
  Chart.register(...Chart.registerables);
  Chart.register(verticalMidnightPlugin);
}

function updateHeaderWeatherVisibility(){
  const headerWeather = document.getElementById('headerWeather');
  const titleText = document.getElementById('titleText');
  const isMobile = window.innerWidth <= 600;
  
  if(isMobile){
    headerWeather.style.display = 'block';
    titleText.style.display = 'none';
  } else {
    headerWeather.style.display = 'none';
    titleText.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  updateHeaderWeatherVisibility();
  initMap(DEFAULT.lat, DEFAULT.lon);
  loadAll(DEFAULT.lat, DEFAULT.lon);
  window.addEventListener('resize', () => {
    updateHeaderWeatherVisibility();
    if(!latestWeatherData) return;
    clearTimeout(resizeChartTimer);
    resizeChartTimer = setTimeout(() => renderChart(latestWeatherData), 150);
  });
});

function initUI(){
  document.getElementById('locBtn').addEventListener('click', useGeolocation);
  document.getElementById('searchBtn').addEventListener('click', async ()=>{
    const q = document.getElementById('searchInput').value.trim();
    if(!q) return;
    const coords = await geocodeCity(q);
    if(coords) { initMap(coords.lat, coords.lon); loadAll(coords.lat, coords.lon); }
    else alert('Stad hittades inte');
  });
}

async function loadAll(lat, lon){
  try{
    const data = await fetchWeather(lat, lon);
    latestWeatherData = data;
    renderCurrent(data);
    renderForecast(data);
    try{
      renderChart(data);
    }catch(chartErr){
      console.error('Chart render failed', chartErr);
      const chartEl = document.getElementById('weatherChart');
      if(chartEl) {
        // show a small message in place of the chart
        const parent = chartEl.parentElement;
        if(parent) parent.querySelector('.chart-error')?.remove();
        const msg = document.createElement('div');
        msg.className = 'chart-error';
        msg.textContent = 'Diagram ej tillgängligt';
        msg.style.padding = '16px';
        parent.appendChild(msg);
      }
    }
  }catch(e){
    console.error('Weather load failed', e);
    document.getElementById('currentContent').textContent = 'Väderdata gick inte att hämta';
  }

  try{ await fetchPollen(lat, lon); }catch(e){
    console.warn('Pollen failed', e);
    document.getElementById('pollenList').textContent = 'Pollendata gick inte att hämta';
  }

  try{ await addRadarLayer(); }catch(e){ console.warn('Radar init failed', e); }
}

async function fetchWeather(lat, lon){
  // Open-Meteo request: hourly and daily plus current
  // Include dewpoint and cloudcover to enable richer charts (no API key required)
  const fields = [
    'hourly=temperature_2m,precipitation,windspeed_10m,uv_index,dewpoint_2m,cloudcover,weathercode',
    'daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,weathercode',
    'current_weather=true',
    'timezone=auto'
  ].join('&');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${fields}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Open-Meteo error');
  return res.json();
}

function renderCurrent(data){
  const cur = data.current_weather;
  const container = document.getElementById('currentContent');
  if(!cur){ container.textContent = 'Inget nuvarande väder'; return; }
  const code = cur.weathercode ?? data.hourly?.weathercode?.[0] ?? 0;
  const icon = getWeatherIcon(code, cur.is_day);
  const condition = getWeatherText(code);
  const windMs = ((cur.windspeed ?? 0) / 3.6).toFixed(1);
  const windDir = getWindDirection(cur.winddirection ?? 0);
  const uvValue = getDailyUV(data);
  const uvLabel = getUVLabel(uvValue);

  const html = `
    <div class="current-temp"><strong>${icon} ${cur.temperature}°C</strong></div>
    <div>Tillstånd: ${condition}</div>
    <div>Vind: ${windMs} m/s, ${windDir}</div>
    <div>UV: ${uvValue ?? '—'} (${uvLabel})</div>
  `;
  
  container.innerHTML = html;
  
  // Also update header weather for mobile
  const headerWeather = document.getElementById('headerWeatherContent');
  if(headerWeather) headerWeather.innerHTML = html;
}

function renderForecast(data){
  const list = document.getElementById('forecastList');
  list.innerHTML = '';
  const days = data.daily?.time || [];
  for(let i=0;i<Math.min(days.length,5);i++){
    const day = formatDateSv(days[i]);
    const min = data.daily.temperature_2m_min[i];
    const max = data.daily.temperature_2m_max[i];
    const rain = data.daily.precipitation_sum?.[i] ?? 0;
    const uvValue = data.daily.uv_index_max?.[i] ?? null;
    const uv = `${uvValue ?? '—'} (${getUVLabel(uvValue)})`;
    const code = data.daily.weathercode?.[i] ?? 0;
    const icon = getWeatherIcon(code, 1);
    const condition = getWeatherText(code);

    const el = document.createElement('div');
    el.className = 'forecast-day';
    el.innerHTML = `<div>${day}</div><div>${icon} ${condition}</div><div>${min}° / ${max}°</div><div>Regn: ${rain} mm</div><div>UV: ${uv}</div>`;
    list.appendChild(el);
  }
}

function getDailyUV(data){
  return data.daily?.uv_index_max?.[0] ?? null;
}

function getUVLabel(value){
  if(value == null) return 'Saknas';
  if(value <= 2) return 'Låg';
  if(value <= 5) return 'Måttlig';
  return 'Hög';
}

function getWindDirection(degrees){
  const dirs = ['N','NO','O','SO','S','SV','V','NV'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return dirs[index];
}

function getWeatherIcon(code, isDay){
  const day = Number(isDay) === 1;
  if(code === 0) return day ? '☀️' : '🌙';
  if([1,2].includes(code)) return day ? '⛅' : '☁️';
  if([3,45,48].includes(code)) return '☁️';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return '🌧️';
  if([71,73,75,77,85,86].includes(code)) return '🌨️';
  if([95,96,99].includes(code)) return '⛈️';
  return '🌤️';
}

function getWeatherText(code){
  if(code === 0) return 'Klart';
  if(code === 1) return 'Nästan klart';
  if(code === 2) return 'Halvklart';
  if(code === 3) return 'Mulet';
  if([45,48].includes(code)) return 'Dimma';
  if([51,53,55].includes(code)) return 'Duggregn';
  if([56,57].includes(code)) return 'Underkylt duggregn';
  if([61,63,65].includes(code)) return 'Regn';
  if([66,67].includes(code)) return 'Underkylt regn';
  if([71,73,75,77].includes(code)) return 'Snö';
  if([80,81,82].includes(code)) return 'Skurar';
  if([85,86].includes(code)) return 'Snöbyar';
  if([95,96,99].includes(code)) return 'Åska';
  return 'Växlande';
}

function formatDateSv(dateStr){
  const date = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('sv-SE', { weekday:'short', day:'numeric', month:'short' }).format(date);
}

function formatDateSvCompact(dateStr){
  const date = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('sv-SE', { day:'numeric', month:'numeric' }).format(date);
}

function getLocalDateString(date = new Date()){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shouldUseCompactChartLabels(){
  return window.innerWidth < 720;
}

function renderChart(data){
  const maxPoints = 168; // up to 7 days hourly
  const rawTimes = data.hourly?.time || [];
  
  // Find current hour index
  const now = new Date();
  const nowHour = now.getHours();
  const nowDate = getLocalDateString(now);
  const nowTimeString = `${nowDate}T${String(nowHour).padStart(2,'0')}:00`;
  
  let startIdx = 0;
  let currentHourIdx = -1;
  
  // Find the index closest to current time
  for(let i = 0; i < rawTimes.length; i++){
    if(rawTimes[i] >= nowTimeString){
      startIdx = i;
      currentHourIdx = 0; // This will be index 0 in our sliced data
      break;
    }
  }
  
  const sliceLen = Math.min(rawTimes.length - startIdx, maxPoints);
  const slicedRawTimes = rawTimes.slice(startIdx, startIdx + sliceLen);
  const times = buildDateLabels(slicedRawTimes);
  const midnightIndices = getMidnightIndices(slicedRawTimes);
  const temps = (data.hourly?.temperature_2m || []).slice(startIdx, startIdx + sliceLen);
  const prec = (data.hourly?.precipitation || []).slice(startIdx, startIdx + sliceLen);
  const windRaw = (data.hourly?.windspeed_10m || []).slice(startIdx, startIdx + sliceLen);
  const wind = windRaw.map(v => v != null ? v / 3.6 : null); // Konvertera från km/h till m/s

  console.log('renderChart: startIdx', startIdx, 'currentHourIdx', currentHourIdx, 'sliceLen', sliceLen);
  console.log('renderChart samples temps[0]', temps[0], 'prec[0]', prec[0], 'wind[0]', wind[0]);
  console.log('Midnight indices found:', midnightIndices);

  renderTemperatureChart(times, temps, midnightIndices, currentHourIdx);
  renderPrecipitationChart(times, prec, midnightIndices, currentHourIdx);
  renderWindChart(times, wind, midnightIndices, currentHourIdx);
}

function getMidnightIndices(times){
  const indices = [];
  times.forEach((time, idx) => {
    const hour = time.slice(11, 13);
    if(hour === '00') indices.push(idx);
  });
  return indices;
}

function buildDateLabels(times){
  const compact = shouldUseCompactChartLabels();
  return times.map(time => {
    const date = time.slice(0, 10);
    const hour = time.slice(11, 13);
    if(hour === '12') return compact ? formatDateSvCompact(date) : formatDateSv(date);
    return '';
  });
}

function getChartCanvasWidth(canvas){
  return Math.max(320, Math.floor(canvas.getBoundingClientRect().width || canvas.clientWidth || 600));
}

function renderTemperatureChart(labels, temps, midnightIndices, currentHourIdx){
  const canvas = document.getElementById('tempChart');
  if(!canvas) return;
  canvas.width = getChartCanvasWidth(canvas);
  canvas.height = 170;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '170px';
  const ctx = canvas.getContext('2d');
  if(weatherCharts.temp) weatherCharts.temp.destroy();

  const lower = temps.map(v=> (v==null?null:v-2));
  const upper = temps.map(v=> (v==null?null:v+2));
  ensureOverlayCanvas(canvas, 'tempChartOverlay');

  weatherCharts.temp = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Lower', data: lower, borderWidth:0, pointRadius:0, backgroundColor:'rgba(0,0,0,0)', fill:false },
        { label:'Band', data: upper, borderWidth:0, pointRadius:0, backgroundColor:'rgba(239,68,68,0.12)', fill:'-1' },
        { type:'line', label:'Temperatur (°C)', data: temps, borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)', tension:0.25, pointRadius:0.5 }
      ]
    },
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        verticalMidnightLines:{ indices: midnightIndices || [] }
      },
      scales:{
        x:{position:'top',grid:{display:false},ticks:{maxRotation:0,minRotation:0,autoSkip:false}},
        y:{type:'linear',title:{display:true,text:'°C'}}
      },
      responsive:false,
      maintainAspectRatio:false
    }
  });
  setTimeout(() => {
    drawMidnightOverlay(weatherCharts.temp, midnightIndices, 'tempChartOverlay');
    if(currentHourIdx >= 0) drawCurrentHourLine(weatherCharts.temp, currentHourIdx, 'Temp');
  }, 100);
}

function renderPrecipitationChart(labels, prec, midnightIndices, currentHourIdx){
  const canvas = document.getElementById('precipChart');
  if(!canvas) return;
  canvas.width = getChartCanvasWidth(canvas);
  canvas.height = 140;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '140px';
  const ctx = canvas.getContext('2d');
  if(weatherCharts.precip) weatherCharts.precip.destroy();
  ensureOverlayCanvas(canvas, 'precipChartOverlay');

  weatherCharts.precip = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label:'Nederbörd (mm)', data: prec, backgroundColor:'rgba(96,165,250,0.8)' }]
    },
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        verticalMidnightLines:{ indices: midnightIndices || [] }
      },
      scales:{
        x:{position:'top',grid:{display:false},ticks:{maxRotation:0,minRotation:0,autoSkip:false}},
        y:{type:'linear',beginAtZero:true,title:{display:true,text:'mm'}}
      },
      responsive:false,
      maintainAspectRatio:false
    }
  });
  setTimeout(() => {
    drawMidnightOverlay(weatherCharts.precip, midnightIndices, 'precipChartOverlay');
    if(currentHourIdx >= 0) drawCurrentHourLine(weatherCharts.precip, currentHourIdx, 'Precip');
  }, 100);
}

function renderWindChart(labels, wind, midnightIndices, currentHourIdx){
  const canvas = document.getElementById('windChart');
  if(!canvas) return;
  canvas.width = getChartCanvasWidth(canvas);
  canvas.height = 140;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '140px';
  const ctx = canvas.getContext('2d');
  if(weatherCharts.wind) weatherCharts.wind.destroy();
  ensureOverlayCanvas(canvas, 'windChartOverlay');

  weatherCharts.wind = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label:'Vind (m/s)', data: wind, borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,0.08)', tension:0.2, pointRadius:0.5, fill:false }]
    },
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        verticalMidnightLines:{ indices: midnightIndices || [] }
      },
      scales:{
        x:{position:'top',grid:{display:false},ticks:{maxRotation:0,minRotation:0,autoSkip:false}},
        y:{type:'linear',title:{display:true,text:'m/s'}}
      },
      responsive:false,
      maintainAspectRatio:false
    }
  });
  setTimeout(() => {
    drawMidnightOverlay(weatherCharts.wind, midnightIndices, 'windChartOverlay');
    if(currentHourIdx >= 0) drawCurrentHourLine(weatherCharts.wind, currentHourIdx, 'Wind');
  }, 100);
}

async function initMap(lat, lon){
  if(!map){
    map = L.map('map').setView([lat, lon], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);
  } else {
    map.setView([lat, lon], 6);
  }
}

async function addRadarLayer(){
  // Fetch RainViewer weather-maps metadata and overlay the latest radar
  try{
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if(!res.ok) throw new Error(`RainViewer API status ${res.status}`);
    const meta = await res.json();
    console.log('RainViewer meta:', meta);
    
    // Combine recent history + current + forecast so one animation shows transition into prognosis
    const pastFrames = meta.radar && Array.isArray(meta.radar.past) ? meta.radar.past : [];
    const nowRaw = meta.radar ? meta.radar.now : null;
    const nowFrames = Array.isArray(nowRaw) ? nowRaw : (nowRaw ? [nowRaw] : []);
    const forecastFrames = meta.radar && Array.isArray(meta.radar.nowcast) ? meta.radar.nowcast : [];
    const recentPastFrames = pastFrames.slice(-6); // keep recent history only (~1-2h)

    allRadarFrames = [...recentPastFrames, ...nowFrames, ...forecastFrames];
    console.log('Total radar frames:', allRadarFrames.length);
    
    if(!allRadarFrames.length) {
      console.warn('No radar frames available');
      return;
    }
    
    const host = meta.host || 'https://tilecache.rainviewer.com';
    
    // Set up slider if we have multiple frames
    if(allRadarFrames.length > 1){
      const slider = document.getElementById('radarSlider');
      const timeDisplay = document.getElementById('radarTime');
      const playBtn = document.getElementById('radarPlayBtn');
      const controls = document.getElementById('radarControls');
      
      const forecastStartIdx = recentPastFrames.length + nowFrames.length;

      slider.max = allRadarFrames.length - 1;
      slider.value = Math.min(forecastStartIdx, allRadarFrames.length - 1); // Start where forecast begins
      controls.style.display = 'block';
      
      const updateFrame = (idx) => {
        const frame = allRadarFrames[idx];
        updateRadarFrame(frame, host);
        
        // Display time
        const date = new Date(frame.time * 1000);
        const isForecast = idx >= forecastStartIdx;
        const label = isForecast ? 'Prognos' : 'Historik';
        timeDisplay.textContent = `${label}: ${date.toLocaleString('sv-SE')}`;
      };

      // Avoid duplicated listeners when reloading layers
      slider.oninput = (e) => {
        updateFrame(parseInt(e.target.value));
        // Stop playback if user manually moves slider
        if(radarPlaying) toggleRadarPlayback();
      };

      playBtn.onclick = toggleRadarPlayback;
      
      function toggleRadarPlayback(){
        if(radarPlaying){
          radarPlaying = false;
          clearInterval(radarPlayInterval);
          playBtn.textContent = '▶ Spela';
        } else {
          radarPlaying = true;
          playBtn.textContent = '⏸ Pausa';
          let idx = parseInt(slider.value);
          radarPlayInterval = setInterval(() => {
            idx++;
            if(idx > slider.max) idx = 0; // Loop
            slider.value = idx;
            updateFrame(idx);
          }, 500); // 500ms per frame
        }
      }

      // Show selected start frame immediately in UI and map
      updateFrame(parseInt(slider.value));
      if(!forecastFrames.length){
        timeDisplay.textContent += ' (ingen prognos tillgänglig just nu)';
      }
    }

    // Fallback when controls are not shown
    if(allRadarFrames.length <= 1){
      updateRadarFrame(allRadarFrames[0], host);
    }
    console.log('RainViewer layer added successfully');
  }catch(e){
    console.error('RainViewer error:', e);
  }
}

function updateRadarFrame(frame, host){
  const path = frame.path || `/v2/radar/${frame.time}`;
  const size = 256; 
  const color = 2; 
  const options = '1_1';
  const url = `${host}${path}/${size}/{z}/{x}/{y}/${color}/${options}.png`;
  
  if(radarLayer) map.removeLayer(radarLayer);
  radarLayer = L.tileLayer(url, {
    opacity:0.6, 
    attribution:'RainViewer', 
    tileSize:256, 
    maxNativeZoom:16, 
    maxZoom:18
  }).addTo(map);
}

// Minimal geocoding using Nominatim
async function geocodeCity(q){
  try{
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const arr = await res.json();
    if(!arr || !arr.length) return null;
    return {lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon)};
  }catch(e){return null}
}

async function useGeolocation(){
  if(!navigator.geolocation){ alert('Platsfunktion stöds inte'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    initMap(lat, lon); loadAll(lat, lon);
  }, err=>{ alert('Platsåtkomst nekad eller otillgänglig'); });
}

// Pollenrapporten: attempt to fetch Swedish pollen forecast. If unavailable, show fallback.
async function fetchPollen(lat, lon){
  const forecastOut = document.getElementById('pollenList');
  const currentOut = document.getElementById('currentPollenList');
  forecastOut.innerHTML = 'Läser in pollen…';
  if(currentOut) currentOut.innerHTML = 'Läser in pollen…';

  try{
    // 1) fetch regions and choose nearest region (or name match)
    const regionsRes = await fetch('https://api.pollenrapporten.se/v1/regions');
    if(!regionsRes.ok) throw new Error('Regions fetch failed');
    const regionsJson = await regionsRes.json();
    const regions = regionsJson.items || [];

    // choose nearest region by geographic distance (use provided lat/lon)
    let nearest = null;
    for(const r of regions){
      if(!r.latitude || !r.longitude) continue;
      const d = haversine(lat, lon, parseFloat(r.latitude), parseFloat(r.longitude));
      if(!nearest || d < nearest.d) nearest = { r, d };
    }
    let region = nearest ? nearest.r : regions[0];
    console.log('Selected pollen region:', region && region.name);

    // 2) fetch pollen types and level definitions
    const [typesRes, levelsRes] = await Promise.all([
      fetch('https://api.pollenrapporten.se/v1/pollen-types'),
      fetch('https://api.pollenrapporten.se/v1/pollen-level-definitions')
    ]);
    const typesJson = typesRes.ok ? await typesRes.json() : {items:[]};
    const levelsJson = levelsRes.ok ? await levelsRes.json() : {items:[]};
    const types = (typesJson.items || []).reduce((m,it)=> (m[it.id]=it, m), {});
    const levelDefs = (levelsJson.items || []).reduce((m,it)=> (m[it.level]=it.name, m), {});

    const forecastsUrl = region.forecasts || `https://api.pollenrapporten.se/v1/forecasts?region_id=${region.id}&current=true`;
    const countsUrl = `https://api.pollenrapporten.se/v1/pollen-count?region_id=${region.id}&offset=0&limit=100&has_technical_error=false`;

    // 3) fetch forecasts and counts for that region
    const [fRes, cRes] = await Promise.all([fetch(forecastsUrl), fetch(countsUrl)]);
    if(!fRes.ok) throw new Error('Forecasts fetch failed');

    const fJson = await fRes.json();
    const forecast = (fJson.items && fJson.items.length) ? fJson.items[0] : null;
    if(!forecast) throw new Error('No forecast for region');

    const cJson = cRes.ok ? await cRes.json() : {items: []};
    const counts = (cJson.items || []).reduce((m, it) => {
      const key = `${it.date}_${it.pollen_id}`;
      m[key] = it.daily_count ?? 0;
      return m;
    }, {});
    
    const currentItems = buildCurrentPollen(forecast, types);
    const forecastData = buildThreeDayForecastByType(forecast, types);

    renderCurrentPollen({currentItems, counts, types});
    renderPollen({forecastData, counts, types});
    return;
  }catch(e){
    console.warn('Pollen endpoint failed', e);
  }

  // Fallback sample data (to ensure UI remains useful)
  const sampleCurrent = [
    {name:'Björk', level:2, pollenId:'1', date:'2026-05-04'},
    {name:'Gräs', level:1, pollenId:'2', date:'2026-05-04'},
    {name:'Gråbo', level:0, pollenId:'3', date:'2026-05-04'}
  ];
  const sampleCounts = {
    '2026-05-04_1': 25,
    '2026-05-04_2': 12,
    '2026-05-04_3': 0,
    '2026-05-05_1': 20,
    '2026-05-05_2': 15,
    '2026-05-05_3': 2,
    '2026-05-06_1': 18,
    '2026-05-06_2': 25,
    '2026-05-06_3': 0
  };
  const sampleForecast = {
    dates: ['mån 4 maj', 'tis 5 maj', 'ons 6 maj'],
    rawDates: ['2026-05-04', '2026-05-05', '2026-05-06'],
    items: [
      {name:'Björk', day1:2, day2:2, day3:1, pollenId:'1'},
      {name:'Gräs', day1:1, day2:2, day3:3, pollenId:'2'},
      {name:'Gråbo', day1:0, day2:0, day3:0, pollenId:'3'}
    ]
  };
  renderCurrentPollen({currentItems: sampleCurrent, counts: sampleCounts});
  renderPollen({forecastData: sampleForecast, counts: sampleCounts});
}

function renderCurrentPollen(data){
  const out = document.getElementById('currentPollenList');
  if(!out) return;
  out.innerHTML = '';
  const currentItems = data.currentItems || [];
  const counts = data.counts || {};

  const pollenOrder = ['Björk', 'Gräs', 'Gråbo'];
  const filteredItems = pollenOrder.map(name => {
    const item = currentItems.find(entry => normalizePollenName(entry.name) === normalizePollenName(name));
    return item || { name, level: 0, pollenId: null, date: null };
  });

  if(filteredItems.length){
    filteredItems.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'pollen-item';
      const lvl = typeof it.level === 'number' ? it.level : 0;
      const cat = getPollenSeverityClass(lvl);
      const label = getPollenSeverityLabel(lvl);
      
      row.innerHTML = `<span>${it.name}:</span><span class="pollen-level ${cat}">${label}</span>`;
      out.appendChild(row);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'pollen-empty';
    empty.textContent = 'Ingen pollenprognos tillgänglig';
    out.appendChild(empty);
  }
  
  // Also update header pollen for mobile
  const headerPollen = document.getElementById('headerPollenContent');
  if(headerPollen) {
    headerPollen.innerHTML = out.innerHTML;
  }
}

function renderPollen(data){
  const out = document.getElementById('pollenList');
  out.innerHTML = '';
  const forecastData = data.forecastData || {};
  const forecastItems = forecastData.items || [];
  const dateLabels = forecastData.dates || ['Dag 1', 'Dag 2', 'Dag 3'];

  if(forecastItems.length){
    // Create table-like layout with dates as column headers
    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'grid';
    headerDiv.style.gridTemplateColumns = 'minmax(80px, auto) 1fr 1fr 1fr';
    headerDiv.style.gap = '8px';
    headerDiv.style.marginBottom = '10px';
    headerDiv.style.fontSize = '0.95em';
    headerDiv.style.fontWeight = 'bold';
    
    // Header row
    const emptyCell = document.createElement('div');
    emptyCell.textContent = '';
    headerDiv.appendChild(emptyCell);
    
    dateLabels.forEach(date => {
      const dateCell = document.createElement('div');
      dateCell.textContent = date;
      dateCell.style.textAlign = 'center';
      dateCell.style.padding = '4px';
      dateCell.style.borderBottom = '2px solid #ddd';
      headerDiv.appendChild(dateCell);
    });
    out.appendChild(headerDiv);
    
    // Data rows - one per pollen type
    forecastItems.forEach(it => {
      const rowDiv = document.createElement('div');
      rowDiv.style.display = 'grid';
      rowDiv.style.gridTemplateColumns = 'minmax(80px, auto) 1fr 1fr 1fr';
      rowDiv.style.gap = '8px';
      rowDiv.style.alignItems = 'center';
      rowDiv.style.marginBottom = '8px';
      rowDiv.style.paddingBottom = '8px';
      rowDiv.style.borderBottom = '1px solid #eee';
      
      // Pollen name in first cell
      const nameCell = document.createElement('div');
      nameCell.style.fontWeight = 'bold';
      nameCell.textContent = it.name;
      rowDiv.appendChild(nameCell);
      
      // Get labels for each day
      const day1Label = getPollenSeverityLabel(it.day1);
      const day2Label = getPollenSeverityLabel(it.day2);
      const day3Label = getPollenSeverityLabel(it.day3);
      
      const day1Class = getPollenSeverityClass(it.day1);
      const day2Class = getPollenSeverityClass(it.day2);
      const day3Class = getPollenSeverityClass(it.day3);
      
      // Day 1
      const day1Cell = document.createElement('div');
      day1Cell.style.textAlign = 'center';
      day1Cell.innerHTML = `<span class="pollen-level ${day1Class}">${day1Label}</span>`;
      rowDiv.appendChild(day1Cell);
      
      // Day 2
      const day2Cell = document.createElement('div');
      day2Cell.style.textAlign = 'center';
      day2Cell.innerHTML = `<span class="pollen-level ${day2Class}">${day2Label}</span>`;
      rowDiv.appendChild(day2Cell);
      
      // Day 3
      const day3Cell = document.createElement('div');
      day3Cell.style.textAlign = 'center';
      day3Cell.innerHTML = `<span class="pollen-level ${day3Class}">${day3Label}</span>`;
      rowDiv.appendChild(day3Cell);
      
      out.appendChild(rowDiv);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'pollen-empty';
    empty.textContent = 'Ingen prognos tillgänglig';
    out.appendChild(empty);
  }
}

function buildCurrentPollen(forecast, types){
  const series = forecast.levelSeries || [];
  const dates = [...new Set(series.map(item=>item.time?.slice(0,10)).filter(Boolean))];
  const today = dates[0];
  const daySeries = series.filter(item => item.time?.startsWith(today));
  const byPollen = new Map();
  daySeries.forEach(entry=>{
    const prev = byPollen.get(entry.pollenId) ?? {level: -1};
    if(entry.level > prev.level) byPollen.set(entry.pollenId, {level: entry.level, pollenId: entry.pollenId});
  });
  return Array.from(byPollen.entries())
    .map(([pollenId, data]) => ({
      name: types[pollenId]?.name || 'Okänt',
      level: data.level,
      pollenId: pollenId,
      date: today
    }))
    .sort((a,b)=>b.level-a.level);
}

function buildThreeDayForecastByType(forecast, types){
  const series = forecast.levelSeries || [];
  const dates = [...new Set(series.map(item=>item.time?.slice(0,10)).filter(Boolean))].slice(0,3);
  const pollenOrder = ['Björk', 'Gräs', 'Gråbo'];
  
  // Store dates globally so we can use them in render
  const dateLabels = dates.map(d => {
    const date = new Date(d + 'T00:00:00');
    return new Intl.DateTimeFormat('sv-SE', { weekday:'short', day:'numeric', month:'short' }).format(date);
  });
  
  return {
    dates: dateLabels,
    rawDates: dates, // Keep raw dates for pollenkorn lookup
    items: pollenOrder.map(pollenName => {
      const dayValues = dates.map(date => {
        const daySeries = series.filter(item => item.time?.startsWith(date));
        const pollenTypeId = Object.keys(types).find(id => 
          normalizePollenName(types[id]?.name) === normalizePollenName(pollenName)
        );
        const entry = daySeries.find(item => item.pollenId == pollenTypeId);
        return {level: entry?.level ?? 0, pollenId: pollenTypeId};
      });
      
      return {
        name: pollenName,
        day1: dayValues[0].level || 0,
        day2: dayValues[1].level || 0,
        day3: dayValues[2].level || 0,
        pollenId: dayValues[0].pollenId
      };
    })
  };
}

function normalizePollenName(name){
  return String(name || '')
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .trim();
}

function getPollenSeverityClass(level){
  if(level >= 5) return 'high';
  if(level >= 2) return 'moderate';
  return 'low';
}

function getPollenSeverityLabel(level){
  if(level >= 5) return 'Hög';
  if(level >= 2) return 'Måttlig';
  return 'Låg';
}

function haversine(lat1, lon1, lat2, lon2){
  const toRad = v => v * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2)) * Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// export for debugging in console
window._dashboard = { loadAll, initMap };
