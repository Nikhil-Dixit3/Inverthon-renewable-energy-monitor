# Renewable Energy Monitor

Full-stack IoT renewable energy monitoring web application built with Node.js, Express.js, MongoDB, Mongoose, HTML, CSS, JavaScript, and Chart.js.

## Features

- Modern dark-theme dashboard with a welcome screen
- Live polling every 4 seconds
- Voltage, current, power, and temperature metric cards
- Online and offline system status indicator
- Live Chart.js graphs for power, voltage, current, and temperature
- Energy analytics for daily energy, monthly energy, and efficiency
- Alert banner for warning conditions
- Fault detection panel for undervoltage, overcurrent, thermal, telemetry, and efficiency issues
- Historical table for the latest 20 readings
- CSV export for dashboard history
- Simulation routes for demo and ESP32-free testing
- Preview fallback data when the backend is unavailable during static demos

## Project Structure

```text
project/
|-- server/
|   |-- app.js
|   |-- server.js
|   |-- models/
|   |   `-- Energy.js
|   `-- routes/
|       `-- api.js
|-- public/
|   |-- index.html
|   |-- style.css
|   `-- dashboard.js
|-- tests/
|   `-- smoke.test.js
|-- package.json
`-- README.md
```

## API Endpoints

- `POST /api/data` - store a sensor reading from ESP32
- `GET /api/data` - fetch latest readings, default limit is 20
- `GET /api/stats` - fetch analytics, alerts, faults, and system status
- `POST /api/simulate` - insert one or more simulated readings
- `POST /api/simulate/fault` - insert a simulated fault reading for dashboard testing
- `GET /api/health` - confirm API and MongoDB connection state

## MongoDB Schema

```js
{
  voltage: Number,
  current: Number,
  power: Number,
  temperature: Number,
  inputPower: Number,
  source: String,
  timestamp: Date
}
```

## How to Run

1. Install dependencies:

```bash
npm install
```

2. Start MongoDB locally or use MongoDB Atlas.

3. Optionally set environment variables:

```powershell
$env:MONGO_URI="mongodb://127.0.0.1:27017/renewable_energy_monitor"
$env:PORT="3000"
```

4. Start the server:

```bash
npm run dev
```

5. Run the smoke tests before publishing:

```bash
npm test
```

6. Open `http://localhost:3000`

## GitHub Pages Deployment

GitHub Pages can host the dashboard frontend, but it cannot run the Express or MongoDB backend. That means:

- The site works immediately on GitHub Pages in preview mode with built-in demo data.
- For live ESP32 data, host the backend separately and set `public/config.js` to that backend URL, including `/api`.

Example `public/config.js`:

```js
window.REM_CONFIG = {
  apiBaseUrl: "https://your-backend.example.com/api"
};
```

To deploy:

1. Keep `public/config.js` empty for preview mode, or set `apiBaseUrl` to your hosted API.
2. Push this repository to GitHub.
3. In GitHub, open `Settings > Pages`.
4. Set the source to `GitHub Actions`.
5. Push to `main` or `master`, or run the `Deploy GitHub Pages` workflow manually.

The workflow runs `npm run build:pages`, publishes the static bundle from `dist/`, and serves the dashboard from your Pages URL.

## Sample ESP32 Payload

```json
{
  "voltage": 228.6,
  "current": 8.4,
  "power": 1712.3,
  "temperature": 37.5,
  "inputPower": 1890.8,
  "timestamp": "2026-03-30T12:30:00.000Z"
}
```

## Sample Requests

Create a live reading:

```bash
curl -X POST http://localhost:3000/api/data \
  -H "Content-Type: application/json" \
  -d "{\"voltage\":228.6,\"current\":8.4,\"power\":1712.3,\"temperature\":37.5,\"inputPower\":1890.8}"
```

Generate demo data:

```bash
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d "{\"count\":24,\"intervalMinutes\":10}"
```

## Publish Checklist

- Set a production `MONGO_URI`
- If using GitHub Pages with live data, host the backend separately and set `public/config.js`
- Confirm `npm test` passes
- Run `npm run build:pages` if you want to inspect the Pages bundle locally
- Start the app with `npm start` or `npm run dev`
- Verify `GET /api/health` returns `api: online`
- Open the dashboard and confirm live data or preview mode is rendering correctly

## Notes

- Daily and monthly energy values are calculated from stored power readings using time-based integration.
- Efficiency is calculated as `output power / input power x 100` when `inputPower` is available.
- The dashboard shows `Offline` when fresh data has not arrived inside the configured online window.
- On GitHub Pages, the dashboard falls back to preview mode unless `public/config.js` points to a hosted backend API.
