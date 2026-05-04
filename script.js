// script.js — Weather Dashboard main logic
// Uses Open-Meteo, RainViewer, and Pollenrapporten (Sweden)

const DEFAULT = { lat: 55.6050, lon: 13.0038, name: 'Malmö' };

let map, radarLayer, weatherCharts = {};

function drawMidnightLines(chart, midnightIndices){
  if(!midnightIndices || midnightIndices.length === 0) return;
  console.log('drawMidnightLines called with indices:', midnightIndices);
  
  const canvas = chart.canvas;
  const ctx = canvas.getContext('2d');
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  
  if(!xScale || !yScale) {
    console.log('No scales available');
    return;
  }
  
  ctx.save();
  ctx.strokeStyle = '#FF0000';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.8;
  
  midnightIndices.forEach(idx => {
    const xPos = xScale.getPixelForValue(idx);
    console.log('Drawing line at index', idx, 'xPos:', xPos);
    ctx.beginPath();
    ctx.moveTo(xPos, chart.chartArea.top);
    ctx.lineTo(xPos, chart.chartArea.bottom);
    ctx.stroke();
  });
  
  ctx.restore();
}

// Chart.js plugin for vertical lines at midnight
const verticalMidnightPlugin = {
  id: 'verticalMidnightLines',
  afterRender(chart){
    const opts = chart.options.plugins?.verticalMidnightLines || {};
    const midnightIndices = opts.indices || [];
    console.log('afterRender: midnightIndices=', midnightIndices);
    if(!midnightIndices || midnightIndices.length === 0) return;
    
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if(!xScale || !yScale) {
      console.log('No scales');
      return;
    }
    
    console.log('xScale min/max:', xScale.min, xScale.max);
    console.log('Chart area:', chart.chartArea);
    
    ctx.save();
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    
    midnightIndices.forEach(idx => {
      // Get pixel position using the index as a data value
      const xPos = xScale.getPixelForValue(idx);
      console.log('Midnight at index', idx, '-> xPos:', xPos);
      
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

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initMap(DEFAULT.lat, DEFAULT.lon);
  loadAll(DEFAULT.lat, DEFAULT.lon);
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

  container.innerHTML = `
    <div class="current-temp"><strong>${icon} ${cur.temperature}°C</strong></div>
    <div>Tillstånd: ${condition}</div>
    <div>Vind: ${windMs} m/s, ${windDir}</div>
    <div>UV: ${uvValue ?? '—'} (${uvLabel})</div>
  `;
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

function renderChart(data){
  const maxPoints = 168; // up to 7 days hourly
  const rawTimes = data.hourly?.time || [];
  const sliceLen = Math.min(rawTimes.length, maxPoints);
  const slicedRawTimes = rawTimes.slice(0, sliceLen);
  const times = buildDateLabels(slicedRawTimes);
  const midnightIndices = getMidnightIndices(slicedRawTimes);
  const temps = (data.hourly?.temperature_2m || []).slice(0, sliceLen);
  const prec = (data.hourly?.precipitation || []).slice(0, sliceLen);
  const wind = (data.hourly?.windspeed_10m || []).slice(0, sliceLen);

  console.log('renderChart: sliceLen', sliceLen);
  console.log('renderChart samples temps[0]', temps[0], 'prec[0]', prec[0], 'wind[0]', wind[0]);
  console.log('Midnight indices found:', midnightIndices);

  renderTemperatureChart(times, temps, midnightIndices);
  renderPrecipitationChart(times, prec, midnightIndices);
  renderWindChart(times, wind, midnightIndices);
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
  let lastDate = '';
  return times.map(time => {
    const date = time.slice(0, 10);
    if(date !== lastDate){
      lastDate = date;
      return formatDateSv(date);
    }
    return '';
  });
}

function renderTemperatureChart(labels, temps, midnightIndices){
  const canvas = document.getElementById('tempChart');
  if(!canvas) return;
  canvas.width = canvas.clientWidth || canvas.width || 600;
  canvas.height = 170;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '170px';
  const ctx = canvas.getContext('2d');
  if(weatherCharts.temp) weatherCharts.temp.destroy();

  const lower = temps.map(v=> (v==null?null:v-2));
  const upper = temps.map(v=> (v==null?null:v+2));

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
        legend:{display:false}
      },
      scales:{
        x:{position:'top',grid:{display:false},ticks:{maxRotation:0,minRotation:0,autoSkip:false}},
        y:{type:'linear',title:{display:true,text:'°C'}}
      },
      responsive:false,
      maintainAspectRatio:false
    }
  });
  setTimeout(() => drawMidnightLines(weatherCharts.temp, midnightIndices), 50);
}

function renderPrecipitationChart(labels, prec, midnightIndices){
  const canvas = document.getElementById('precipChart');
  if(!canvas) return;
  canvas.width = canvas.clientWidth || canvas.width || 600;
  canvas.height = 140;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '140px';
  const ctx = canvas.getContext('2d');
  if(weatherCharts.precip) weatherCharts.precip.destroy();

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
}

function renderWindChart(labels, wind, midnightIndices){
  const canvas = document.getElementById('windChart');
  if(!canvas) return;
  canvas.width = canvas.clientWidth || canvas.width || 600;
  canvas.height = 140;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '140px';
  const ctx = canvas.getContext('2d');
  if(weatherCharts.wind) weatherCharts.wind.destroy();

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
}

async function initMap(lat, lon){
  if(!map){
    map = L.map('map').setView([lat, lon], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);
  } else {
    map.setView([lat, lon], 8);
  }
}

async function addRadarLayer(){
  // Fetch RainViewer weather-maps metadata and overlay the latest radar
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if(!res.ok) throw new Error('RainViewer maps fetch failed');
  const meta = await res.json();
  // meta should contain host and radar.past array of frames {time, path}
  const host = meta.host || 'https://tilecache.rainviewer.com';
  const frames = meta.radar && Array.isArray(meta.radar.past) ? meta.radar.past : [];
  if(!frames.length) return;
  const frame = frames[frames.length-1];
  const path = frame.path || `/v2/radar/${frame.time}`;
    // build tile URL: {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
    const size = 256; const color = 2; const options = '1_1';
  const url = `${host}${path}/${size}/{z}/{x}/{y}/${color}/${options}.png`;
  if(radarLayer) map.removeLayer(radarLayer);
  // RainViewer supports limited native zoom; limit requests to avoid "Zoom Level Not Supported" tiles
  radarLayer = L.tileLayer(url, {opacity:0.6, attribution:'RainViewer', tileSize:256, maxNativeZoom:10, maxZoom:12}).addTo(map);
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

    // find exact name match first
    let region = regions.find(r=> (r.name||'').toLowerCase().includes('malm'));
    if(!region){
      // fallback: nearest by distance
      region = regions.reduce((best,r)=>{
        if(!r.latitude || !r.longitude) return best;
        const d = haversine(lat, lon, parseFloat(r.latitude), parseFloat(r.longitude));
        if(!best || d < best.d) return {r, d};
        return best;
      }, null);
      region = region && region.r ? region.r : regions[0];
    }

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
    const currentItems = buildCurrentPollen(forecast, types);
    const forecastItems = buildThreeDayForecast(forecast, types);

    renderCurrentPollen({currentItems});
    renderPollen({forecastItems});
    return;
  }catch(e){
    console.warn('Pollen endpoint failed', e);
  }

  // Fallback sample data (to ensure UI remains useful)
  const sample = [
    {name:'Björk', level:2},
    {name:'Gräs', level:1},
    {name:'Al', level:3}
  ];
  renderCurrentPollen({currentItems: sample});
  renderPollen({forecastItems: sample});
}

function renderCurrentPollen(data){
  const out = document.getElementById('currentPollenList');
  if(!out) return;
  out.innerHTML = '';
  const currentItems = data.currentItems || [];

  const currentSection = document.createElement('div');
  currentSection.className = 'pollen-section';
  currentSection.innerHTML = '<h3>Pollenprognos</h3>';

  const pollenOrder = ['Björk', 'Gräs', 'Gråbo'];
  const filteredItems = pollenOrder.map(name => {
    const item = currentItems.find(entry => normalizePollenName(entry.name) === normalizePollenName(name));
    return item || { name, level: 0 };
  });

  if(filteredItems.length){
    filteredItems.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'pollen-item';
      const lvl = typeof it.level === 'number' ? it.level : 0;
      const cat = getPollenSeverityClass(lvl);
      const label = getPollenSeverityLabel(lvl);
      row.innerHTML = `<div>${it.name}</div><div>${lvl} <span class="pollen-level ${cat}">${label}</span></div>`;
      currentSection.appendChild(row);
    });
  } else {
    currentSection.innerHTML += '<div class="pollen-empty">Ingen pollenprognos tillgänglig</div>';
  }

  out.appendChild(currentSection);
}

function renderPollen(data){
  const out = document.getElementById('pollenList');
  out.innerHTML = '';
  const forecastItems = data.forecastItems || [];

  const forecastSection = document.createElement('div');
  forecastSection.className = 'pollen-section';
  forecastSection.innerHTML = '<h3>3-dygnsprognos</h3>';

  if(forecastItems.length){
    const pollenOrder = ['Björk', 'Gräs', 'Gråbo'];
    const filteredItems = pollenOrder.map(name => {
      const item = forecastItems.find(entry => normalizePollenName(entry.name) === normalizePollenName(name));
      return item || { name, level: 0 };
    });

    filteredItems.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'pollen-item';
      const lvl = typeof it.level === 'number' ? it.level : (it.level || 0);
      const cat = getPollenSeverityClass(lvl);
      const label = getPollenSeverityLabel(lvl);
      row.innerHTML = `<div>${it.name}</div><div>${lvl} <span class="pollen-level ${cat}">${label}</span></div>`;
      forecastSection.appendChild(row);
    });
  } else {
    forecastSection.innerHTML += '<div class="pollen-empty">Ingen prognos tillgänglig</div>';
  }

  out.appendChild(forecastSection);
}

function buildCurrentPollen(forecast, types){
  const series = forecast.levelSeries || [];
  const dates = [...new Set(series.map(item=>item.time?.slice(0,10)).filter(Boolean))];
  const today = dates[0];
  const daySeries = series.filter(item => item.time?.startsWith(today));
  const byPollen = new Map();
  daySeries.forEach(entry=>{
    const prev = byPollen.get(entry.pollenId) ?? -1;
    if(entry.level > prev) byPollen.set(entry.pollenId, entry.level);
  });
  return Array.from(byPollen.entries())
    .map(([pollenId, level]) => ({
      name: types[pollenId]?.name || 'Okänt',
      level,
    }))
    .sort((a,b)=>b.level-a.level);
}

function buildThreeDayForecast(forecast, types){
  const series = forecast.levelSeries || [];
  const dates = [...new Set(series.map(item=>item.time?.slice(0,10)).filter(Boolean))].slice(0,3);
  return dates.map(date => {
    const daySeries = series.filter(item => item.time?.startsWith(date));
    const maxByPollen = new Map();
    daySeries.forEach(entry => {
      const prev = maxByPollen.get(entry.pollenId) ?? -1;
      if(entry.level > prev) maxByPollen.set(entry.pollenId, entry.level);
    });
    const strongest = Array.from(maxByPollen.entries()).sort((a,b)=>b[1]-a[1])[0] || [null, 0];
    const pollenName = strongest[0] ? (types[strongest[0]]?.name || 'Okänt') : 'Inga halter';
    const level = strongest[1];
    return {
      name: pollenName,
      level,
    };
  });
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
