# Weather Dashboard (HTML/CSS/JS)

Simple weather dashboard using Open-Meteo, RainViewer and Pollenrapporten.

Quick start:

1. Open `index.html` in a browser (double-click or use a static server).
2. The app defaults to Malmö (lat: 55.6050, lon: 13.0038).
3. Use the search box or "Use My Location" to change location.

Notes:
- Chart.js and Leaflet are loaded via CDN.
- Pollenrapporten API endpoints may require API keys or CORS handling; the UI will show fallback sample data if unavailable.
- This is a vanilla JS, beginner-friendly implementation.

Files:
- index.html — layout and includes
- style.css — basic responsive styling
- script.js — main logic: fetches, map, chart
