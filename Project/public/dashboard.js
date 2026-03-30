// Frontend controller for polling APIs, rendering live charts, and handling dashboard actions.
const POLL_INTERVAL_MS = 4000;
const CHART_LIMIT = 30;
const STATIC_PREVIEW_PORTS = new Set(["5500", "5501", "5502", "5503"]);
const IS_STATIC_PREVIEW =
  window.location.protocol === "file:" ||
  STATIC_PREVIEW_PORTS.has(window.location.port);
const API_BASE = IS_STATIC_PREVIEW ? "http://localhost:3000/api" : "/api";
const PREVIEW_THRESHOLDS = {
  voltageLow: 210,
  currentHigh: 15,
  temperatureHigh: 55,
  voltageCriticalLow: 200,
  currentCriticalHigh: 18,
  temperatureCriticalHigh: 62,
  efficiencyLow: 78
};
const SEVERITY_LABELS = {
  normal: "Normal",
  warning: "Warning",
  major: "Major",
  critical: "Critical"
};

const appState = {
  chartInstances: {},
  historyRecords: [],
  hasLoadedData: false,
  chartsReady: false,
  lastRecords: [],
  lastStats: null
};

const elements = {
  welcomeScreen: document.getElementById("welcomeScreen"),
  dashboardApp: document.getElementById("dashboardApp"),
  enterDashboardButton: document.getElementById("enterDashboardButton"),
  previewStatusButton: document.getElementById("previewStatusButton"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  alertBanner: document.getElementById("alertBanner"),
  actionMessage: document.getElementById("actionMessage"),
  statusBadge: document.getElementById("statusBadge"),
  statusDot: document.getElementById("liveStatusDot"),
  systemStatusText: document.getElementById("systemStatusText"),
  lastUpdatedText: document.getElementById("lastUpdatedText"),
  voltageValue: document.getElementById("voltageValue"),
  currentValue: document.getElementById("currentValue"),
  powerValue: document.getElementById("powerValue"),
  temperatureValue: document.getElementById("temperatureValue"),
  energyTodayValue: document.getElementById("energyTodayValue"),
  monthlyEnergyValue: document.getElementById("monthlyEnergyValue"),
  efficiencyValue: document.getElementById("efficiencyValue"),
  samplesTodayValue: document.getElementById("samplesTodayValue"),
  samplesMonthValue: document.getElementById("samplesMonthValue"),
  voltageThresholdValue: document.getElementById("voltageThresholdValue"),
  currentThresholdValue: document.getElementById("currentThresholdValue"),
  temperatureThresholdValue: document.getElementById("temperatureThresholdValue"),
  onlineWindowValue: document.getElementById("onlineWindowValue"),
  healthBadge: document.getElementById("healthBadge"),
  alertCountValue: document.getElementById("alertCountValue"),
  faultCountValue: document.getElementById("faultCountValue"),
  severityValue: document.getElementById("severityValue"),
  esgGauge: document.getElementById("esgGauge"),
  gaugeEfficiencyText: document.getElementById("gaugeEfficiencyText"),
  alertList: document.getElementById("alertList"),
  faultList: document.getElementById("faultList"),
  recordCountText: document.getElementById("recordCountText"),
  historyTableBody: document.getElementById("historyTableBody"),
  simulateButton: document.getElementById("simulateButton"),
  simulateFaultButton: document.getElementById("simulateFaultButton"),
  refreshButton: document.getElementById("refreshButton"),
  exportButton: document.getElementById("exportButton"),
  projectYear: document.getElementById("projectYear")
};

function setLoadingState(isLoading) {
  elements.loadingOverlay.classList.toggle("hidden", !isLoading);
}

function setActionMessage(message, tone = "default") {
  elements.actionMessage.textContent = message;
  elements.actionMessage.className = "action-message";

  if (tone !== "default") {
    elements.actionMessage.classList.add(tone);
  }
}

function formatMetric(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return `0.00 ${unit}`;
  }

  return `${Number(value).toFixed(2)} ${unit}`;
}

function formatEnergy(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return `0.00 ${unit}`;
  }

  return `${Number(value).toFixed(2)} ${unit}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Waiting for data...";
  }

  return new Date(timestamp).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

function formatTimeOnly(timestamp) {
  if (!timestamp) {
    return "--";
  }

  return new Date(timestamp).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function setSystemStatus(status) {
  const normalizedStatus = status === "Online" ? "Online" : "Offline";
  const stateClass = normalizedStatus.toLowerCase();

  elements.systemStatusText.textContent = normalizedStatus;
  elements.statusBadge.textContent = normalizedStatus;
  elements.statusBadge.className = `status-badge ${stateClass}`;
  elements.statusDot.className = `status-dot ${stateClass}`;
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

function summarizeHealth(alerts, faults) {
  const severityOrder = {
    normal: 0,
    warning: 1,
    major: 2,
    critical: 3
  };
  const allIssues = [...alerts, ...faults];
  const highestSeverity = allIssues.reduce((currentHighest, issue) => {
    return severityOrder[issue.severity] > severityOrder[currentHighest]
      ? issue.severity
      : currentHighest;
  }, "normal");

  const labels = {
    normal: "Nominal",
    warning: "Warning Active",
    major: "Major Fault",
    critical: "Critical Fault"
  };

  return {
    alertCount: alerts.length,
    faultCount: faults.length,
    highestSeverity,
    label: labels[highestSeverity]
  };
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
      totalWh += ((currentRecord.power + nextRecord.power) / 2) * elapsedHours;
    }
  }

  return Number(totalWh.toFixed(2));
}

function buildPreviewAlerts(latestRecord, thresholds, efficiency) {
  const alerts = [];

  if (!latestRecord) {
    return alerts;
  }

  if (latestRecord.voltage < thresholds.voltageLow) {
    alerts.push(
      createIssue({
        code: "ALT-VOLTAGE-LOW",
        title: "Low Voltage Alert",
        message: `Voltage dropped below ${thresholds.voltageLow} V at ${latestRecord.voltage.toFixed(
          1
        )} V.`,
        severity:
          latestRecord.voltage < thresholds.voltageCriticalLow ? "major" : "warning",
        category: "voltage"
      })
    );
  }

  if (latestRecord.current > thresholds.currentHigh) {
    alerts.push(
      createIssue({
        code: "ALT-CURRENT-HIGH",
        title: "High Current Alert",
        message: `Current exceeded ${thresholds.currentHigh} A at ${latestRecord.current.toFixed(
          1
        )} A.`,
        severity:
          latestRecord.current > thresholds.currentCriticalHigh ? "major" : "warning",
        category: "current"
      })
    );
  }

  if (latestRecord.temperature > thresholds.temperatureHigh) {
    alerts.push(
      createIssue({
        code: "ALT-TEMP-HIGH",
        title: "High Temperature Alert",
        message: `Temperature crossed ${thresholds.temperatureHigh} C at ${latestRecord.temperature.toFixed(
          1
        )} C.`,
        severity:
          latestRecord.temperature > thresholds.temperatureCriticalHigh
            ? "major"
            : "warning",
        category: "temperature"
      })
    );
  }

  if (efficiency !== null && efficiency < thresholds.efficiencyLow) {
    alerts.push(
      createIssue({
        code: "ALT-EFFICIENCY-LOW",
        title: "Efficiency Drop Alert",
        message: `System efficiency dropped to ${efficiency.toFixed(
          1
        )}%, below the recommended level.`,
        severity: efficiency < thresholds.efficiencyLow - 8 ? "major" : "warning",
        category: "efficiency"
      })
    );
  }

  return alerts;
}

function buildPreviewFaults(latestRecord, thresholds, efficiency) {
  const faults = [];

  if (!latestRecord) {
    return faults;
  }

  if (latestRecord.voltage < thresholds.voltageCriticalLow) {
    faults.push(
      createIssue({
        code: "FLT-UNDERVOLTAGE",
        title: "Critical Undervoltage Fault",
        message: `Voltage has fallen to ${latestRecord.voltage.toFixed(
          1
        )} V. Inspect inverter output and bus stability.`,
        severity: "critical",
        category: "voltage"
      })
    );
  }

  if (latestRecord.current > thresholds.currentCriticalHigh) {
    faults.push(
      createIssue({
        code: "FLT-OVERCURRENT",
        title: "Critical Overcurrent Fault",
        message: `Current has reached ${latestRecord.current.toFixed(
          1
        )} A. Inspect wiring and isolate excess load.`,
        severity: "critical",
        category: "current"
      })
    );
  }

  if (latestRecord.temperature > thresholds.temperatureCriticalHigh) {
    faults.push(
      createIssue({
        code: "FLT-THERMAL",
        title: "Thermal Fault",
        message: `Temperature reached ${latestRecord.temperature.toFixed(
          1
        )} C. Cooling intervention or shutdown may be required.`,
        severity: "critical",
        category: "temperature"
      })
    );
  }

  if (efficiency !== null && efficiency < thresholds.efficiencyLow - 8) {
    faults.push(
      createIssue({
        code: "FLT-EFFICIENCY",
        title: "Efficiency Loss Fault",
        message: `Efficiency has dropped to ${efficiency.toFixed(
          1
        )}%. Inspect panel, inverter, and load conditions.`,
        severity: "major",
        category: "efficiency"
      })
    );
  }

  return faults;
}

function buildPreviewRecords(options = {}) {
  const { faultMode = false } = options;
  const now = Date.now();

  return Array.from({ length: 24 }, (_, index) => {
    let voltage = 224 + Math.sin(index / 3) * 7;
    let current = 8.4 + Math.cos(index / 4) * 2.2;
    let temperature = 33 + Math.sin(index / 5) * 5 + index * 0.1;
    let efficiencyRatio = 0.91;

    if (index === 23 && faultMode) {
      voltage = 197.6;
      current = 19.4;
      temperature = 64.1;
      efficiencyRatio = 0.67;
    } else if (index === 23) {
      voltage = 226.4;
      current = 9.8;
      temperature = 39.6;
      efficiencyRatio = 0.9;
    }

    const power = voltage * current * 0.88;

    return {
      id: `preview-${index}`,
      voltage: Number(voltage.toFixed(2)),
      current: Number(current.toFixed(2)),
      power: Number(power.toFixed(2)),
      temperature: Number(temperature.toFixed(2)),
      inputPower: Number((power / efficiencyRatio).toFixed(2)),
      source: "Preview",
      timestamp: new Date(now - (23 - index) * 5 * 60000).toISOString()
    };
  });
}

function buildPreviewStats(records) {
  const latestRecord = records[records.length - 1] || null;
  const thresholds = PREVIEW_THRESHOLDS;
  const efficiency = latestRecord
    ? Number(((latestRecord.power / latestRecord.inputPower) * 100).toFixed(2))
    : null;
  const alerts = buildPreviewAlerts(latestRecord, thresholds, efficiency);
  const faults = buildPreviewFaults(latestRecord, thresholds, efficiency);

  return {
    latest: latestRecord,
    systemStatus: "Online",
    lastSeenAt: latestRecord?.timestamp || null,
    analytics: {
      energyTodayWh: calculateEnergyWh(records),
      monthlyEnergyKWh: Number((calculateEnergyWh(records) / 1000).toFixed(2)),
      efficiency,
      samplesToday: records.length,
      samplesThisMonth: records.length
    },
    alerts,
    faults,
    health: summarizeHealth(alerts, faults),
    thresholds,
    onlineWindowSeconds: 20
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Request failed.");
  }

  return payload;
}

function createLineChart(canvasId, label, color) {
  const context = document.getElementById(canvasId);

  if (canvasId === "powerChart") {
    return new Chart(context, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Energy Produced",
            data: [],
            borderColor: "#3ff3cb",
            backgroundColor: "rgba(63, 243, 203, 0.2)",
            pointRadius: 0,
            tension: 0.42,
            fill: true,
            borderWidth: 2.4
          },
          {
            label: "Energy Consumption",
            data: [],
            borderColor: "#f4c15f",
            backgroundColor: "rgba(244, 193, 95, 0.18)",
            pointRadius: 0,
            tension: 0.42,
            fill: true,
            borderWidth: 2.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: "index"
        },
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            grid: {
              color: "rgba(142, 163, 188, 0.1)"
            },
            ticks: {
              color: "#9db1ca",
              maxRotation: 0
            }
          },
          y: {
            grid: {
              color: "rgba(142, 163, 188, 0.1)"
            },
            ticks: {
              color: "#9db1ca"
            }
          }
        }
      }
    });
  }

  const isMiniChart = canvasId !== "temperatureChart";

  return new Chart(context, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: `${color}22`,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.42,
          fill: !isMiniChart,
          borderWidth: isMiniChart ? 2.2 : 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          display: !isMiniChart,
          grid: {
            color: "rgba(142, 163, 188, 0.1)",
            display: !isMiniChart
          },
          ticks: {
            color: "#9db1ca",
            maxRotation: 0
          }
        },
        y: {
          display: !isMiniChart,
          grid: {
            color: "rgba(142, 163, 188, 0.1)",
            display: !isMiniChart
          },
          ticks: {
            color: "#9db1ca"
          }
        }
      }
    }
  });
}

function initializeCharts() {
  appState.chartInstances.voltage = createLineChart(
    "voltageChart",
    "Voltage",
    "#3ff3cb"
  );
  appState.chartInstances.current = createLineChart(
    "currentChart",
    "Current",
    "#5bb8ff"
  );
  appState.chartInstances.power = createLineChart(
    "powerChart",
    "Power",
    "#f4c15f"
  );
  appState.chartInstances.temperature = createLineChart(
    "temperatureChart",
    "Temperature",
    "#ff7b96"
  );
}

function updateCharts(records) {
  if (!appState.chartInstances.voltage) {
    return;
  }

  const labels = records.map((record) => formatTimeOnly(record.timestamp));
  const consumptionSeries = records.map((record, index) =>
    Number(
      (
        record.power *
        (0.52 + ((Math.sin(index * 0.9) + 1) / 2) * 0.32)
      ).toFixed(2)
    )
  );

  appState.chartInstances.voltage.data.labels = labels;
  appState.chartInstances.voltage.data.datasets[0].data = records.map(
    (record) => record.voltage
  );

  appState.chartInstances.current.data.labels = labels;
  appState.chartInstances.current.data.datasets[0].data = records.map(
    (record) => record.current
  );

  appState.chartInstances.power.data.labels = labels;
  appState.chartInstances.power.data.datasets[0].data = records.map(
    (record) => record.power
  );
  appState.chartInstances.power.data.datasets[1].data = consumptionSeries;

  appState.chartInstances.temperature.data.labels = labels;
  appState.chartInstances.temperature.data.datasets[0].data = records.map(
    (record) => record.temperature
  );

  Object.values(appState.chartInstances).forEach((chart) => chart.update());
}

function updateMetrics(latestRecord) {
  elements.voltageValue.textContent = formatMetric(latestRecord?.voltage, "V");
  elements.currentValue.textContent = formatMetric(latestRecord?.current, "A");
  elements.powerValue.textContent = formatMetric(latestRecord?.power, "W");
  elements.temperatureValue.textContent = formatMetric(
    latestRecord?.temperature,
    "C"
  );
}

function updateAnalytics(stats) {
  const efficiency =
    stats.analytics.efficiency === null ? null : Number(stats.analytics.efficiency);

  elements.energyTodayValue.textContent = formatEnergy(
    stats.analytics.energyTodayWh,
    "Wh"
  );
  elements.monthlyEnergyValue.textContent = formatEnergy(
    stats.analytics.monthlyEnergyKWh,
    "kWh"
  );
  elements.efficiencyValue.textContent =
    efficiency === null
      ? "--"
      : `${efficiency.toFixed(2)} %`;
  elements.samplesTodayValue.textContent = String(stats.analytics.samplesToday);
  elements.samplesMonthValue.textContent = String(
    stats.analytics.samplesThisMonth
  );

  elements.voltageThresholdValue.textContent = `${stats.thresholds.voltageLow.toFixed(
    1
  )} V`;
  elements.currentThresholdValue.textContent = `${stats.thresholds.currentHigh.toFixed(
    1
  )} A`;
  elements.temperatureThresholdValue.textContent = `${stats.thresholds.temperatureHigh.toFixed(
    1
  )} C`;
  elements.onlineWindowValue.textContent = `${stats.onlineWindowSeconds} sec`;

  if (elements.esgGauge) {
    const gaugeFill =
      efficiency === null ? 68 : Math.max(12, Math.min(100, efficiency));

    elements.esgGauge.style.setProperty("--gauge-fill", `${gaugeFill}%`);
  }

  if (elements.gaugeEfficiencyText) {
    elements.gaugeEfficiencyText.textContent =
      efficiency === null ? "--" : `${efficiency.toFixed(0)}%`;
  }
}

function updateProtectionLayer(stats) {
  const health = stats.health || summarizeHealth(stats.alerts || [], stats.faults || []);
  const highestSeverity = health.highestSeverity || "normal";

  elements.alertCountValue.textContent = String(health.alertCount || 0);
  elements.faultCountValue.textContent = String(health.faultCount || 0);
  elements.severityValue.textContent =
    SEVERITY_LABELS[highestSeverity] || SEVERITY_LABELS.normal;
  elements.severityValue.className = `severity-indicator severity-${highestSeverity}`;
  elements.healthBadge.textContent = health.label || "Nominal";
  elements.healthBadge.className = `health-badge health-${highestSeverity}`;
}

function renderIssueList(container, issues, emptyMessage) {
  if (!issues.length) {
    container.innerHTML = `<div class="issue-empty">${emptyMessage}</div>`;
    return;
  }

  container.innerHTML = issues
    .map(
      (issue) => `
        <article class="issue-item">
          <div class="issue-header">
            <div>
              <div class="issue-title">${issue.title}</div>
              <div class="issue-code">${issue.code}</div>
            </div>
            <span class="severity-pill severity-${issue.severity}">${issue.severity}</span>
          </div>
          <p class="issue-message">${issue.message}</p>
        </article>
      `
    )
    .join("");
}

function updateAlerts(alerts, faults) {
  const combinedIssues = [...faults, ...alerts];

  if (!combinedIssues.length) {
    elements.alertBanner.classList.add("hidden");
    elements.alertBanner.textContent = "";
    elements.alertBanner.className = "alert-banner hidden";
    return;
  }

  const leadIssue = combinedIssues[0];
  const extraCount = combinedIssues.length - 1;
  const tone = faults.length ? "critical" : "warning";

  elements.alertBanner.classList.remove("hidden");
  elements.alertBanner.className = `alert-banner alert-${tone}`;
  elements.alertBanner.textContent = `${
    faults.length ? "Critical Fault" : "Active Alert"
  }: ${leadIssue.message}${
    extraCount > 0 ? ` (${extraCount} more active incident${extraCount > 1 ? "s" : ""})` : ""
  }`;
}

function updateHistoryTable(records) {
  const historyRows = [...records].slice(-20).reverse();
  appState.historyRecords = historyRows;
  elements.recordCountText.textContent = `${historyRows.length} records loaded`;

  if (!historyRows.length) {
    elements.historyTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          No readings available yet. Start sending ESP32 data or simulate one sample.
        </td>
      </tr>
    `;
    return;
  }

  elements.historyTableBody.innerHTML = historyRows
    .map(
      (record) => `
        <tr>
          <td>${formatTimestamp(record.timestamp)}</td>
          <td>${Number(record.voltage).toFixed(2)}</td>
          <td>${Number(record.current).toFixed(2)}</td>
          <td>${Number(record.power).toFixed(2)}</td>
          <td>${Number(record.temperature).toFixed(2)}</td>
        </tr>
      `
    )
    .join("");
}

function renderDashboard(records, stats) {
  const latestRecord = stats.latest || records[records.length - 1] || null;

  appState.lastRecords = records;
  appState.lastStats = stats;
  updateMetrics(latestRecord);
  updateAnalytics(stats);
  updateProtectionLayer(stats);
  renderIssueList(
    elements.alertList,
    stats.alerts || [],
    "No active alerts. System is inside warning limits."
  );
  renderIssueList(
    elements.faultList,
    stats.faults || [],
    "No active faults detected."
  );
  updateAlerts(stats.alerts || [], stats.faults || []);
  updateHistoryTable(records);
  updateCharts(records);
  setSystemStatus(stats.systemStatus);
  elements.lastUpdatedText.textContent = formatTimestamp(stats.lastSeenAt);
  appState.hasLoadedData = true;
}

async function refreshDashboard(showLoader = false) {
  if (showLoader) {
    setLoadingState(true);
  }

  try {
    const [dataPayload, statsPayload] = await Promise.all([
      fetchJson(`${API_BASE}/data?limit=${CHART_LIMIT}&order=asc`),
      fetchJson(`${API_BASE}/stats`)
    ]);

    renderDashboard(dataPayload.data || [], statsPayload);
    setActionMessage(
      typeof Chart === "undefined"
        ? "Live data synced, but Chart.js is unavailable so graphs are hidden."
        : "Live data synced successfully.",
      typeof Chart === "undefined" ? "error" : "success"
    );
  } catch (error) {
    const previewRecords = buildPreviewRecords();
    const previewStats = buildPreviewStats(previewRecords);

    renderDashboard(previewRecords, previewStats);
    setActionMessage(
      IS_STATIC_PREVIEW
        ? "Preview mode is active. Start the Node server for live backend data."
        : "Backend unavailable. Showing preview dashboard data.",
      "success"
    );
  } finally {
    setLoadingState(false);
  }
}

function exportHistoryToCsv() {
  if (!appState.historyRecords.length) {
    setActionMessage("No history records available to export yet.", "error");
    return;
  }

  const headers = ["Time", "Voltage (V)", "Current (A)", "Power (W)", "Temperature (C)"];
  const rows = appState.historyRecords.map((record) => [
    formatTimestamp(record.timestamp),
    record.voltage,
    record.current,
    record.power,
    record.temperature
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = downloadUrl;
  anchor.download = `renewable-energy-history-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
  setActionMessage("CSV export downloaded successfully.", "success");
}

async function simulateReading() {
  elements.simulateButton.disabled = true;

  try {
    await fetchJson(`${API_BASE}/simulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ count: 1 })
    });

    setActionMessage("Sample ESP32 reading generated successfully.", "success");
    await refreshDashboard();
  } catch (error) {
    const previewRecords = buildPreviewRecords();
    const previewStats = buildPreviewStats(previewRecords);

    renderDashboard(previewRecords, previewStats);
    setActionMessage(
      "Preview reading loaded locally because the backend is unavailable.",
      "success"
    );
  } finally {
    elements.simulateButton.disabled = false;
  }
}

async function simulateFault() {
  elements.simulateFaultButton.disabled = true;

  try {
    await fetchJson(`${API_BASE}/simulate/fault`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setActionMessage("Simulated fault injected successfully.", "success");
    await refreshDashboard();
  } catch (error) {
    const previewRecords = buildPreviewRecords({ faultMode: true });
    const previewStats = buildPreviewStats(previewRecords);

    renderDashboard(previewRecords, previewStats);
    setActionMessage(
      "Preview fault scenario loaded locally because the backend is unavailable.",
      "success"
    );
  } finally {
    elements.simulateFaultButton.disabled = false;
  }
}

function openDashboard() {
  elements.welcomeScreen.classList.add("hidden");
  elements.dashboardApp.classList.remove("hidden");

  if (typeof Chart !== "undefined" && !appState.chartsReady) {
    initializeCharts();
    appState.chartsReady = true;
  }

  if (appState.hasLoadedData && appState.lastStats) {
    renderDashboard(appState.lastRecords, appState.lastStats);
  } else {
    refreshDashboard(true);
  }
}

function showWelcomeOverview() {
  elements.previewStatusButton.textContent = "Live IoT + Analytics + Alerts";
  window.setTimeout(() => {
    elements.previewStatusButton.textContent = "View System Intro";
  }, 1800);
}

function attachEventListeners() {
  elements.enterDashboardButton.addEventListener("click", openDashboard);
  elements.previewStatusButton.addEventListener("click", showWelcomeOverview);
  elements.simulateButton.addEventListener("click", simulateReading);
  elements.simulateFaultButton.addEventListener("click", simulateFault);
  elements.exportButton.addEventListener("click", exportHistoryToCsv);
  elements.refreshButton.addEventListener("click", () => refreshDashboard(true));
}

function initializeApp() {
  elements.projectYear.textContent = String(new Date().getFullYear());
  attachEventListeners();

  if (typeof Chart === "undefined") {
    setActionMessage("Chart.js failed to load. Graphs are temporarily unavailable.", "error");
  }

  refreshDashboard(false);
  window.setInterval(() => refreshDashboard(false), POLL_INTERVAL_MS);
}

initializeApp();
