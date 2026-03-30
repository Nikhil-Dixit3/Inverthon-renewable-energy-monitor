const express = require("express");
const mongoose = require("mongoose");

const Energy = require("../models/Energy");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 120;
const ONLINE_WINDOW_MS = Number(process.env.ONLINE_WINDOW_MS || 20000);

const THRESHOLDS = {
  voltageLow: Number(process.env.VOLTAGE_LOW_THRESHOLD || 210),
  currentHigh: Number(process.env.CURRENT_HIGH_THRESHOLD || 15),
  temperatureHigh: Number(process.env.TEMPERATURE_HIGH_THRESHOLD || 55),
  voltageCriticalLow: Number(process.env.VOLTAGE_CRITICAL_LOW_THRESHOLD || 200),
  currentCriticalHigh: Number(process.env.CURRENT_CRITICAL_HIGH_THRESHOLD || 18),
  temperatureCriticalHigh: Number(
    process.env.TEMPERATURE_CRITICAL_HIGH_THRESHOLD || 62
  ),
  efficiencyLow: Number(process.env.EFFICIENCY_LOW_THRESHOLD || 78)
};

const SEVERITY_RANK = {
  normal: 0,
  warning: 1,
  major: 2,
  critical: 3
};

function round(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function ensureNumber(value, fieldName, options = {}) {
  const { required = true, min = Number.NEGATIVE_INFINITY } = options;

  if (value === undefined || value === null || value === "") {
    if (!required) {
      return null;
    }

    throw new Error(`${fieldName} is required.`);
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  if (numericValue < min) {
    throw new Error(`${fieldName} must be greater than or equal to ${min}.`);
  }

  return numericValue;
}

function normalizeLimit(limit) {
  const parsedLimit = Number.parseInt(limit, 10);

  if (!Number.isFinite(parsedLimit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);
}

function startOfToday(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(now) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function calculateEnergyWh(records) {
  if (records.length < 2) {
    return 0;
  }

  let totalWh = 0;

  for (let index = 0; index < records.length - 1; index += 1) {
    const currentRecord = records[index];
    const nextRecord = records[index + 1];
    const currentTime = new Date(currentRecord.timestamp).getTime();
    const nextTime = new Date(nextRecord.timestamp).getTime();
    const elapsedHours = (nextTime - currentTime) / 3600000;

    if (elapsedHours > 0) {
      // Trapezoidal integration gives a smoother energy estimate for live sensor streams.
      totalWh += ((currentRecord.power + nextRecord.power) / 2) * elapsedHours;
    }
  }

  return round(totalWh);
}

function createIssue({ code, title, message, severity, category }) {
  return {
    code,
    title,
    message,
    severity,
    category
  };
}

function buildAlerts(reading, efficiency) {
  const alerts = [];

  if (!reading) {
    return alerts;
  }

  if (reading.voltage < THRESHOLDS.voltageLow) {
    alerts.push(
      createIssue({
        code: "ALT-VOLTAGE-LOW",
        title: "Low Voltage Alert",
        message: `Voltage dropped below safe threshold at ${round(
          reading.voltage,
          1
        )} V.`,
        severity:
          reading.voltage < THRESHOLDS.voltageCriticalLow ? "major" : "warning",
        category: "voltage"
      })
    );
  }

  if (reading.current > THRESHOLDS.currentHigh) {
    alerts.push(
      createIssue({
        code: "ALT-CURRENT-HIGH",
        title: "High Current Alert",
        message: `Current exceeded limit at ${round(reading.current, 1)} A.`,
        severity:
          reading.current > THRESHOLDS.currentCriticalHigh ? "major" : "warning",
        category: "current"
      })
    );
  }

  if (reading.temperature > THRESHOLDS.temperatureHigh) {
    alerts.push(
      createIssue({
        code: "ALT-TEMP-HIGH",
        title: "High Temperature Alert",
        message: `Temperature crossed warning level at ${round(
          reading.temperature,
          1
        )} C.`,
        severity:
          reading.temperature > THRESHOLDS.temperatureCriticalHigh
            ? "major"
            : "warning",
        category: "temperature"
      })
    );
  }

  if (efficiency !== null && efficiency < THRESHOLDS.efficiencyLow) {
    alerts.push(
      createIssue({
        code: "ALT-EFFICIENCY-LOW",
        title: "Efficiency Drop Alert",
        message: `Conversion efficiency dropped to ${round(
          efficiency,
          1
        )}%, below the recommended level.`,
        severity: efficiency < THRESHOLDS.efficiencyLow - 8 ? "major" : "warning",
        category: "efficiency"
      })
    );
  }

  return alerts;
}

function buildFaults(reading, context) {
  const faults = [];
  const { systemStatus, efficiency, lastSeenAt } = context;

  if (!reading || systemStatus === "Offline") {
    faults.push(
      createIssue({
        code: "FLT-TELEMETRY-OFFLINE",
        title: "Telemetry Fault",
        message: lastSeenAt
          ? `No fresh sensor reading received. Last telemetry was recorded at ${new Date(
              lastSeenAt
            ).toLocaleString("en-IN")}.`
          : "No telemetry is available from the monitoring node.",
        severity: "critical",
        category: "connectivity"
      })
    );
  }

  if (!reading) {
    return faults;
  }

  if (reading.voltage < THRESHOLDS.voltageCriticalLow) {
    faults.push(
      createIssue({
        code: "FLT-UNDERVOLTAGE",
        title: "Critical Undervoltage Fault",
        message: `Voltage has fallen to ${round(
          reading.voltage,
          1
        )} V. Immediate inspection of inverter output is recommended.`,
        severity: "critical",
        category: "voltage"
      })
    );
  }

  if (reading.current > THRESHOLDS.currentCriticalHigh) {
    faults.push(
      createIssue({
        code: "FLT-OVERCURRENT",
        title: "Critical Overcurrent Fault",
        message: `Current has reached ${round(
          reading.current,
          1
        )} A. Load isolation and wiring inspection are recommended.`,
        severity: "critical",
        category: "current"
      })
    );
  }

  if (reading.temperature > THRESHOLDS.temperatureCriticalHigh) {
    faults.push(
      createIssue({
        code: "FLT-THERMAL",
        title: "Thermal Fault",
        message: `Temperature reached ${round(
          reading.temperature,
          1
        )} C. Cooling or shutdown action may be required.`,
        severity: "critical",
        category: "temperature"
      })
    );
  }

  if (efficiency !== null && efficiency < THRESHOLDS.efficiencyLow - 8) {
    faults.push(
      createIssue({
        code: "FLT-EFFICIENCY",
        title: "Efficiency Loss Fault",
        message: `System efficiency has fallen to ${round(
          efficiency,
          1
        )}%. Check panels, inverter conversion, and load conditions.`,
        severity: "major",
        category: "efficiency"
      })
    );
  }

  return faults;
}

function summarizeHealth(alerts, faults) {
  const issues = [...alerts, ...faults];
  const highestSeverity = issues.reduce((currentHighest, issue) => {
    return SEVERITY_RANK[issue.severity] > SEVERITY_RANK[currentHighest]
      ? issue.severity
      : currentHighest;
  }, "normal");

  const labelBySeverity = {
    normal: "Nominal",
    warning: "Warning Active",
    major: "Major Fault",
    critical: "Critical Fault"
  };

  return {
    alertCount: alerts.length,
    faultCount: faults.length,
    highestSeverity,
    label: labelBySeverity[highestSeverity]
  };
}

function serializeReading(reading) {
  if (!reading) {
    return null;
  }

  return {
    id: String(reading._id),
    voltage: reading.voltage,
    current: reading.current,
    power: reading.power,
    temperature: reading.temperature,
    inputPower: reading.inputPower,
    source: reading.source,
    timestamp: new Date(reading.timestamp).toISOString()
  };
}

function buildSimulationReadings(count, intervalMinutes) {
  const now = Date.now();

  return Array.from({ length: count }, (_, index) => {
    const ageSteps = count - index - 1;
    const solarWave = 0.88 + Math.sin((now / 300000 + index) / 2) * 0.12;
    const loadWave = 0.92 + Math.cos((now / 240000 + index) / 3) * 0.08;
    const voltage = round(224 + Math.sin(index / 3) * 8 + randomBetween(-3, 3));
    const current = round(
      Math.max(1.2, (8 + Math.cos(index / 4) * 2.8 + randomBetween(-1, 1)) * solarWave)
    );
    const power = round(voltage * current * loadWave);
    const efficiencyRatio = randomBetween(0.82, 0.96);
    const temperature = round(31 + Math.sin(index / 5) * 5 + randomBetween(0, 7));

    return {
      voltage,
      current,
      power,
      temperature,
      inputPower: round(power / efficiencyRatio),
      source: "Simulation",
      timestamp: new Date(now - ageSteps * intervalMinutes * 60000)
    };
  });
}

function buildFaultSimulationReading() {
  const voltage = round(THRESHOLDS.voltageCriticalLow - randomBetween(3, 8));
  const current = round(THRESHOLDS.currentCriticalHigh + randomBetween(1.2, 2.8));
  const temperature = round(
    THRESHOLDS.temperatureCriticalHigh + randomBetween(1.5, 4.5)
  );
  const power = round(voltage * current * 0.84);
  const efficiencyRatio = randomBetween(0.62, 0.69);

  return {
    voltage,
    current,
    power,
    temperature,
    inputPower: round(power / efficiencyRatio),
    source: "Fault Simulation",
    timestamp: new Date()
  };
}

function createApiRouter(options = {}) {
  const EnergyModel = options.EnergyModel || Energy;
  const router = express.Router();

  router.get("/health", (req, res) => {
    const databaseStates = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting"
    };

    res.json({
      api: "online",
      database: databaseStates[mongoose.connection.readyState] || "unknown",
      timestamp: new Date().toISOString()
    });
  });

  router.post("/data", async (req, res) => {
    try {
      const payload = req.body || {};
      const voltage = ensureNumber(payload.voltage, "voltage", { min: 0 });
      const current = ensureNumber(payload.current, "current", { min: 0 });
      const power =
        payload.power === undefined || payload.power === null || payload.power === ""
          ? round(voltage * current)
          : ensureNumber(payload.power, "power", { min: 0 });
      const temperature = ensureNumber(payload.temperature, "temperature");
      const inputPower = ensureNumber(payload.inputPower, "inputPower", {
        required: false,
        min: 0
      });
      const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();

      if (Number.isNaN(timestamp.getTime())) {
        throw new Error("timestamp must be a valid ISO date.");
      }

      const reading = await EnergyModel.create({
        voltage,
        current,
        power,
        temperature,
        inputPower,
        source: payload.source || "ESP32",
        timestamp
      });

      res.status(201).json({
        message: "Reading stored successfully.",
        data: serializeReading(reading)
      });
    } catch (error) {
      res.status(400).json({
        error: "Unable to store reading.",
        details: error.message
      });
    }
  });

  router.get("/data", async (req, res) => {
    try {
      const limit = normalizeLimit(req.query.limit);
      const order = req.query.order === "asc" ? "asc" : "desc";
      const latestReadings = await EnergyModel.find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();

      const orderedReadings =
        order === "asc" ? [...latestReadings].reverse() : latestReadings;

      res.json({
        total: orderedReadings.length,
        latest: serializeReading(latestReadings[0] || null),
        data: orderedReadings.map(serializeReading)
      });
    } catch (error) {
      res.status(500).json({
        error: "Unable to fetch sensor readings.",
        details: error.message
      });
    }
  });

  router.get("/stats", async (req, res) => {
    try {
      const now = new Date();
      const todayStart = startOfToday(now);
      const monthStart = startOfMonth(now);

      const [latestReading, todayReadings, monthlyReadings] = await Promise.all([
        EnergyModel.findOne().sort({ timestamp: -1 }).lean(),
        EnergyModel.find({ timestamp: { $gte: todayStart } })
          .sort({ timestamp: 1 })
          .lean(),
        EnergyModel.find({ timestamp: { $gte: monthStart } })
          .sort({ timestamp: 1 })
          .lean()
      ]);

      const systemStatus =
        latestReading &&
        now.getTime() - new Date(latestReading.timestamp).getTime() <= ONLINE_WINDOW_MS
          ? "Online"
          : "Offline";

      const efficiency =
        latestReading && latestReading.inputPower
          ? round((latestReading.power / latestReading.inputPower) * 100)
          : null;
      const lastSeenAt = latestReading
        ? new Date(latestReading.timestamp).toISOString()
        : null;
      const alerts = buildAlerts(latestReading, efficiency);
      const faults = buildFaults(latestReading, {
        systemStatus,
        efficiency,
        lastSeenAt
      });
      const health = summarizeHealth(alerts, faults);

      res.json({
        latest: serializeReading(latestReading),
        systemStatus,
        lastSeenAt,
        analytics: {
          energyTodayWh: calculateEnergyWh(todayReadings),
          monthlyEnergyKWh: round(calculateEnergyWh(monthlyReadings) / 1000),
          efficiency,
          samplesToday: todayReadings.length,
          samplesThisMonth: monthlyReadings.length
        },
        alerts,
        faults,
        health,
        thresholds: THRESHOLDS,
        onlineWindowSeconds: Math.floor(ONLINE_WINDOW_MS / 1000)
      });
    } catch (error) {
      res.status(500).json({
        error: "Unable to compute dashboard analytics.",
        details: error.message
      });
    }
  });

  router.post("/simulate", async (req, res) => {
    try {
      const payload = req.body || {};
      const count = Math.floor(
        ensureNumber(payload.count === undefined ? 1 : payload.count, "count", {
          min: 1
        })
      );
      const intervalMinutes = Math.floor(
        ensureNumber(
          payload.intervalMinutes === undefined ? 5 : payload.intervalMinutes,
          "intervalMinutes",
          { min: 1 }
        )
      );
      const sampleCount = Math.min(count, 50);
      const records = buildSimulationReadings(sampleCount, intervalMinutes);
      const savedRecords = await EnergyModel.insertMany(records);

      res.status(201).json({
        message:
          sampleCount === 1
            ? "Sample sensor reading created."
            : `${sampleCount} sample sensor readings created.`,
        data: savedRecords.map(serializeReading)
      });
    } catch (error) {
      res.status(400).json({
        error: "Unable to create simulated data.",
        details: error.message
      });
    }
  });

  router.post("/simulate/fault", async (req, res) => {
    try {
      const reading = await EnergyModel.create(buildFaultSimulationReading());

      res.status(201).json({
        message: "Simulated fault reading created successfully.",
        data: serializeReading(reading)
      });
    } catch (error) {
      res.status(500).json({
        error: "Unable to create simulated fault reading.",
        details: error.message
      });
    }
  });

  return router;
}

const router = createApiRouter();

module.exports = router;
module.exports.createApiRouter = createApiRouter;
