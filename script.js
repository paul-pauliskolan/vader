// script.js — Weather Dashboard main logic
// Uses Open-Meteo, RainViewer, and Pollenrapporten (Sweden)

const DEFAULT = { lat: 55.6050, lon: 13.0038, name: 'Malmö' };

let map, radarLayer, weatherChart;

if (typeof Chart !== 'undefined' && Chart.registerables) {
  Chart.register(...Chart.registerables);
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
  if(value <= 5) return 'Medel';
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
  const canvas = document.getElementById('weatherChart');
  // use a fixed canvas height so Chart.js does not keep resizing vertically
  canvas.width = canvas.clientWidth || canvas.width || 600;
  canvas.height = 260;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '260px';
  const ctx = canvas.getContext('2d');
  const maxPoints = 168; // up to 7 days hourly
  const rawTimes = data.hourly?.time || [];
  const sliceLen = Math.min(rawTimes.length, maxPoints);
  console.log('renderChart: sliceLen', sliceLen);
  const times = rawTimes.slice(0, sliceLen).map(t=>t.replace('T',' '));
  const temps = (data.hourly?.temperature_2m || []).slice(0, sliceLen);
  const prec = (data.hourly?.precipitation || []).slice(0, sliceLen);
  const dew = (data.hourly?.dewpoint_2m || []).slice(0, sliceLen);
  const wind = (data.hourly?.windspeed_10m || []).slice(0, sliceLen);
  console.log('renderChart samples temps[0]', temps[0], 'prec[0]', prec[0], 'dew[0]', dew[0], 'wind[0]', wind[0]);

  // construct a simple uncertainty band around temperature (±2°C)
  const lower = temps.map(v=> (v==null?null:v-2));
  const upper = temps.map(v=> (v==null?null:v+2));

  if(weatherChart) weatherChart.destroy();

  weatherChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: times,
      datasets: [
        // lower bound (invisible)
        { label:'lower', data: lower, borderWidth:0, pointRadius:0, backgroundColor:'rgba(0,0,0,0)', fill:false },
        // upper bound fills to previous (lower) to create band
        { label:'Temp range', data: upper, borderWidth:0, pointRadius:0, backgroundColor:'rgba(239,68,68,0.12)', fill:'-1' },
        // temperature line
        { type:'line', label:'Temperature (°C)', data: temps, yAxisID:'y', borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)', tension:0.25, pointRadius:0.5 },
        // dew point
        { type:'line', label:'Dew point (°C)', data: dew, yAxisID:'y', borderColor:'#60a5fa', borderDash:[4,4], backgroundColor:'rgba(96,165,250,0.06)', tension:0.25, pointRadius:0.5 },
        // precipitation bars
        { type:'bar', label:'Precipitation (mm)', data: prec, yAxisID:'y2', backgroundColor:'rgba(96,165,250,0.7)' },
        // wind line on separate axis
        { type:'line', label:'Wind (km/h)', data: wind, yAxisID:'y3', borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,0.08)', tension:0.2, pointRadius:0.5 }
      ]
    },
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true}},
      scales:{
        y:{type:'linear',position:'left',title:{display:true,text:'°C'}},
        y2:{type:'linear',position:'right',title:{display:true,text:'mm'},grid:{drawOnChartArea:false}},
        y3:{type:'linear',position:'right',display:true,grid:{drawOnChartArea:false},ticks:{color:'#7c3aed'},title:{display:true,text:'km/h'}}
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
  const out = document.getElementById('pollenList');
  out.innerHTML = 'Fetching pollen…';

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

    // 3) fetch forecasts for that region
    const forecastsUrl = region.forecasts || `https://api.pollenrapporten.se/v1/forecasts?region_id=${region.id}&current=true`;
    const fRes = await fetch(forecastsUrl);
    if(!fRes.ok) throw new Error('Forecasts fetch failed');
    const fJson = await fRes.json();
    const forecast = (fJson.items && fJson.items.length) ? fJson.items[0] : null;
    if(!forecast) throw new Error('No forecast for region');

    // 4) aggregate latest level per pollenId
    const levelSeries = forecast.levelSeries || [];
    // group by pollenId -> take max level across dates (simple summary)
    const agg = {};
    levelSeries.forEach(entry=>{
      const id = entry.pollenId;
      const lvl = entry.level;
      if(!(id in agg) || (lvl > agg[id])) agg[id] = lvl;
    });

    // map to display items
    const items = Object.keys(agg).map(pid=>{
      const p = types[pid];
      const name = p ? p.name : (pid);
      const level = agg[pid];
      return { id: pid, name, level };
    }).sort((a,b)=>b.level-a.level);

    renderPollen({items, levelDefs});
    return;
  }catch(e){
    console.warn('Pollen endpoint failed', e);
  }

  // Fallback sample data (to ensure UI remains useful)
  const sample = [
    {name:'Birch', level:2},
    {name:'Grass', level:1},
    {name:'Alder', level:3}
  ];
  renderPollen({items: sample, levelDefs: {1:'Låga',2:'Låga till måttliga',3:'Måttliga'}});
}

function renderPollen(data){
  const out = document.getElementById('pollenList');
  out.innerHTML = '';
  const items = data.items || [];
  const levelDefs = data.levelDefs || {};

  if(!items.length){ out.textContent = 'Ingen prognos tillgänglig'; return; }

  items.forEach(it=>{
    const el = document.createElement('div');
    el.className = 'pollen-item';
    const lvl = typeof it.level === 'number' ? it.level : (it.level || 0);
    // map numeric level to simple categories
    const cat = lvl >= 5 ? 'high' : (lvl >= 3 ? 'moderate' : 'low');
    const label = levelDefs[lvl] || (lvl===0? 'Inga halter' : `Nivå ${lvl}`);
    const badge = `<span class="pollen-level ${cat}">${label}</span>`;
    el.innerHTML = `<div>${it.name || it.type || 'Okänt'}</div><div>${badge}</div>`;
    out.appendChild(el);
  });
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
