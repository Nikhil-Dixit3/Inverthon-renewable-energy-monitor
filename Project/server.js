const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/renewable_monitor";

const AUTH_USERNAME = process.env.DASHBOARD_USERNAME || "admin";
const AUTH_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin123";
const DEFAULT_REFRESH_INTERVAL_MS = Number(
  process.env.REFRESH_INTERVAL_MS || 4000
);
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

const dashboardSettings = {
  siteName: process.env.SITE_NAME || "RenewGrid",
  operatorName: process.env.OPERATOR_NAME || "Admin Station",
  operatorRole: process.env.OPERATOR_ROLE || "Plant Supervisor",
  voltageLowThreshold: Number(process.env.VOLTAGE_LOW_THRESHOLD || 210),
  currentHighThreshold: Number(process.env.CURRENT_HIGH_THRESHOLD || 15),
  temperatureHighThreshold: Number(
    process.env.TEMPERATURE_HIGH_THRESHOLD || 60
  ),
  onlineWindowSeconds: Number(process.env.ONLINE_WINDOW_SECONDS || 15),
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  alertsEnabled: true
};

let useMockMode = USE_MOCK_DATA;
let mockReadings = [];
const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// A single reading captured from the energy system.
const sensorReadingSchema = new mongoose.Schema(
  {
    voltage: { type: Number, required: true },
    current: { type: Number, required: true },
    power: { type: Number, required: true },
    temperature: { type: Number, required: true },
    inputPower: { type: Number, default: null }
  },
  {
    timestamps: true
  }
);

const SensorReading = mongoose.model("SensorReading", sensorReadingSchema);

function buildMockReadings() {
  const now = Date.now();

  return Array.from({ length: 30 }, (_, index) => {
    const minutesAgo = 29 - index;
    const createdAt = new Date(now - minutesAgo * 60 * 1000);
    const voltage = 224 + Math.sin(index / 4) * 6;
    const current = 8 + Math.cos(index / 5) * 1.2;
    const power = voltage * current * 0.82;
    const temperature = 34 + Math.sin(index / 6) * 4;

    return {
      voltage,
      current,
      power,
      temperature,
      inputPower: power * 1.14,
      createdAt
    };
  });
}

function startOfToday(date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calculateEnergyWh(records) {
  if (records.length < 2) {
    return 0;
  }

  let totalWh = 0;

  for (let i = 0; i < records.length - 1; i += 1) {
    const current = records[i];
    const next = records[i + 1];
    const currentTime = new Date(current.createdAt).getTime();
    const nextTime = new Date(next.createdAt).getTime();
    const elapsedHours = (nextTime - currentTime) / 3600000;

    if (elapsedHours > 0) {
      // Trapezoidal integration smooths small reading fluctuations.
      totalWh += ((current.power + next.power) / 2) * elapsedHours;
    }
  }

  return totalWh;
}

function buildAlerts(reading) {
  const alerts = [];

  if (!reading || !dashboardSettings.alertsEnabled) {
    return alerts;
  }

  if (reading.voltage < dashboardSettings.voltageLowThreshold) {
    alerts.push(`Voltage is below threshold (${reading.voltage.toFixed(1)} V).`);
  }

  if (reading.current > dashboardSettings.currentHighThreshold) {
    alerts.push(`Current is above threshold (${reading.current.toFixed(1)} A).`);
  }

  if (reading.temperature > dashboardSettings.temperatureHighThreshold) {
    alerts.push(
      `Temperature is above threshold (${reading.temperature.toFixed(1)} °C).`
    );
  }

  return alerts;
}

function formatReading(reading) {
  return {
    time: reading.createdAt,
    voltage: reading.voltage,
    current: reading.current,
    power: reading.power,
    temperature: reading.temperature,
    inputPower: reading.inputPower
  };
}

function parseNumericField(value, fieldName, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new Error(`${fieldName} is required.`);
    }

    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return numericValue;
}

function normalizeSettings(payload) {
  return {
    siteName: String(payload.siteName || "").trim() || dashboardSettings.siteName,
    operatorName:
      String(payload.operatorName || "").trim() || dashboardSettings.operatorName,
    operatorRole:
      String(payload.operatorRole || "").trim() || dashboardSettings.operatorRole,
    voltageLowThreshold: parseNumericField(
      payload.voltageLowThreshold,
      "voltageLowThreshold"
    ),
    currentHighThreshold: parseNumericField(
      payload.currentHighThreshold,
      "currentHighThreshold"
    ),
    temperatureHighThreshold: parseNumericField(
      payload.temperatureHighThreshold,
      "temperatureHighThreshold"
    ),
    onlineWindowSeconds: parseNumericField(
      payload.onlineWindowSeconds,
      "onlineWindowSeconds"
    ),
    refreshIntervalMs: parseNumericField(
      payload.refreshIntervalMs,
      "refreshIntervalMs"
    ),
    alertsEnabled: Boolean(payload.alertsEnabled)
  };
}

function publicSettings() {
  return {
    ...dashboardSettings,
    mockMode: useMockMode
  };
}

function createSession() {
  const token = crypto.randomBytes(24).toString("hex");
  const session = {
    token,
    username: AUTH_USERNAME,
    role: "Administrator",
    createdAt: new Date().toISOString()
  };

  sessions.set(token, session);
  return session;
}

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token || !sessions.has(token)) {
    res.status(401).json({
      error: "Authentication required."
    });
    return;
  }

  req.session = sessions.get(token);
  next();
}

async function fetchDashboardPayload() {
  if (useMockMode) {
    const records = mockReadings.length ? mockReadings : buildMockReadings();
    mockReadings = records;
    const latestReading = records[records.length - 1];
    const now = new Date();
    const alerts = buildAlerts(latestReading);
    const todayRecords = records.filter(
      (record) => new Date(record.createdAt) >= startOfToday(now)
    );
    const monthRecords = records.filter(
      (record) => new Date(record.createdAt) >= startOfMonth(now)
    );

    return {
      metrics: {
        voltage: latestReading.voltage,
        current: latestReading.current,
        power: latestReading.power,
        temperature: latestReading.temperature,
        status: "Online"
      },
      analytics: {
        totalEnergyTodayWh: calculateEnergyWh(todayRecords),
        monthlyEnergyKWh: calculateEnergyWh(monthRecords) / 1000,
        efficiency: (latestReading.power / latestReading.inputPower) * 100
      },
      alerts,
      history: [...records].reverse().slice(0, 20).map(formatReading),
      charts: {
        labels: records.map((record) =>
          new Date(record.createdAt).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          })
        ),
        voltage: records.map((record) => record.voltage),
        current: records.map((record) => record.current),
        power: records.map((record) => record.power),
        temperature: records.map((record) => record.temperature)
      },
      thresholds: {
        voltageLow: dashboardSettings.voltageLowThreshold,
        currentHigh: dashboardSettings.currentHighThreshold,
        temperatureHigh: dashboardSettings.temperatureHighThreshold
      },
      settings: publicSettings(),
      updatedAt: now,
      mockMode: true
    };
  }

  const now = new Date();
  const todayStart = startOfToday(now);
  const monthStart = startOfMonth(now);

  const [latestReading, historyRecords, chartRecords, todayRecords, monthRecords] =
    await Promise.all([
      SensorReading.findOne().sort({ createdAt: -1 }).lean(),
      SensorReading.find().sort({ createdAt: -1 }).limit(20).lean(),
      SensorReading.find()
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
      SensorReading.find({ createdAt: { $gte: todayStart } })
        .sort({ createdAt: 1 })
        .lean(),
      SensorReading.find({ createdAt: { $gte: monthStart } })
        .sort({ createdAt: 1 })
        .lean()
    ]);

  const isOnline =
    latestReading &&
    (now.getTime() - new Date(latestReading.createdAt).getTime()) / 1000 <=
      dashboardSettings.onlineWindowSeconds;

  const efficiency =
    latestReading && latestReading.inputPower && latestReading.inputPower > 0
      ? (latestReading.power / latestReading.inputPower) * 100
      : null;

  const alerts = buildAlerts(latestReading);
  const chartSeries = [...chartRecords].reverse().map(formatReading);

  return {
    metrics: {
      voltage: latestReading?.voltage ?? 0,
      current: latestReading?.current ?? 0,
      power: latestReading?.power ?? 0,
      temperature: latestReading?.temperature ?? 0,
      status: isOnline ? "Online" : "Offline"
    },
    analytics: {
      totalEnergyTodayWh: calculateEnergyWh(todayRecords),
      monthlyEnergyKWh: calculateEnergyWh(monthRecords) / 1000,
      efficiency
    },
    alerts,
    history: historyRecords.map(formatReading),
    charts: {
      labels: chartSeries.map((record) =>
        new Date(record.time).toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      ),
      voltage: chartSeries.map((record) => record.voltage),
      current: chartSeries.map((record) => record.current),
      power: chartSeries.map((record) => record.power),
      temperature: chartSeries.map((record) => record.temperature)
    },
    thresholds: {
      voltageLow: dashboardSettings.voltageLowThreshold,
      currentHigh: dashboardSettings.currentHighThreshold,
      temperatureHigh: dashboardSettings.temperatureHighThreshold
    },
    settings: publicSettings(),
    updatedAt: now
  };
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
    res.status(401).json({
      error: "Invalid username or password."
    });
    return;
  }

  const session = createSession();
  res.json({
    token: session.token,
    user: {
      username: session.username,
      role: session.role
    }
  });
});

app.get("/api/auth/session", (req, res) => {
  const token = extractToken(req);
  const session = token ? sessions.get(token) : null;

  if (!session) {
    res.json({
      authenticated: false
    });
    return;
  }

  res.json({
    authenticated: true,
    user: {
      username: session.username,
      role: session.role
    }
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  sessions.delete(req.session.token);
  res.json({
    success: true
  });
});

app.get("/api/settings", (req, res) => {
  res.json(publicSettings());
});

app.put("/api/settings", (req, res) => {
  try {
    const updatedSettings = normalizeSettings(req.body || {});
    Object.assign(dashboardSettings, updatedSettings);
    res.json(publicSettings());
  } catch (error) {
    res.status(400).json({
      error: "Invalid settings payload.",
      details: error.message
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const payload = await fetchDashboardPayload();
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Unable to load dashboard data.",
      details: error.message
    });
  }
});

// Simple ingestion endpoint for ESP32 or any other producer.
app.post("/api/readings", async (req, res) => {
  try {
    const { voltage, current, power, temperature, inputPower } = req.body;
    const normalizedReading = {
      voltage: parseNumericField(voltage, "voltage"),
      current: parseNumericField(current, "current"),
      power: parseNumericField(power, "power"),
      temperature: parseNumericField(temperature, "temperature"),
      inputPower: parseNumericField(inputPower, "inputPower", {
        required: false
      })
    };

    if (useMockMode) {
      const reading = {
        ...normalizedReading,
        createdAt: new Date()
      };
      mockReadings.push(reading);
      mockReadings = mockReadings.slice(-100);

      res.status(201).json({
        message: "Reading stored successfully in mock mode.",
        reading: formatReading(reading)
      });
      return;
    }

    const reading = await SensorReading.create(normalizedReading);

    res.status(201).json({
      message: "Reading stored successfully.",
      reading: formatReading(reading)
    });
  } catch (error) {
    res.status(400).json({
      error: "Invalid reading payload.",
      details: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startServer() {
  if (useMockMode) {
    mockReadings = buildMockReadings();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT} (mock mode)`);
    });
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
  } catch (error) {
    useMockMode = true;
    mockReadings = buildMockReadings();
    console.warn(
      `MongoDB unavailable (${error.message}). Starting in mock mode instead.`
    );
  }

  app.listen(PORT, () => {
    console.log(
      `Server running on http://localhost:${PORT}${
        useMockMode ? " (mock mode)" : ""
      }`
    );
  });
}

startServer();
