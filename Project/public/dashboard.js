// Frontend controller for polling APIs, rendering live charts, and handling dashboard actions.
const POLL_INTERVAL_MS = 4000;
const CHART_LIMIT = 30;

const appState = {
  chartInstances: {},
  historyRecords: []
};

const elements = {
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
  recordCountText: document.getElementById("recordCountText"),
  historyTableBody: document.getElementById("historyTableBody"),
  simulateButton: document.getElementById("simulateButton"),
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
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true,
          borderWidth: 2
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
            color: "rgba(151, 171, 194, 0.08)"
          },
          ticks: {
            color: "#97abc2",
            maxRotation: 0
          }
        },
        y: {
          grid: {
            color: "rgba(151, 171, 194, 0.08)"
          },
          ticks: {
            color: "#97abc2"
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
    "#5eead4"
  );
  appState.chartInstances.current = createLineChart(
    "currentChart",
    "Current",
    "#38bdf8"
  );
  appState.chartInstances.power = createLineChart(
    "powerChart",
    "Power",
    "#fbbf24"
  );
  appState.chartInstances.temperature = createLineChart(
    "temperatureChart",
    "Temperature",
    "#fb7185"
  );
}

function updateCharts(records) {
  if (!appState.chartInstances.voltage) {
    return;
  }

  const labels = records.map((record) => formatTimeOnly(record.timestamp));

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
  elements.energyTodayValue.textContent = formatEnergy(
    stats.analytics.energyTodayWh,
    "Wh"
  );
  elements.monthlyEnergyValue.textContent = formatEnergy(
    stats.analytics.monthlyEnergyKWh,
    "kWh"
  );
  elements.efficiencyValue.textContent =
    stats.analytics.efficiency === null
      ? "--"
      : `${Number(stats.analytics.efficiency).toFixed(2)} %`;
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
}

function updateAlerts(alerts) {
  if (!alerts.length) {
    elements.alertBanner.classList.add("hidden");
    elements.alertBanner.textContent = "";
    return;
  }

  elements.alertBanner.classList.remove("hidden");
  elements.alertBanner.textContent = `Warning: ${alerts.join(" ")}`;
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

  updateMetrics(latestRecord);
  updateAnalytics(stats);
  updateAlerts(stats.alerts || []);
  updateHistoryTable(records);
  updateCharts(records);
  setSystemStatus(stats.systemStatus);
  elements.lastUpdatedText.textContent = formatTimestamp(stats.lastSeenAt);
}

async function refreshDashboard(showLoader = false) {
  if (showLoader) {
    setLoadingState(true);
  }

  try {
    const [dataPayload, statsPayload] = await Promise.all([
      fetchJson(`/api/data?limit=${CHART_LIMIT}&order=asc`),
      fetchJson("/api/stats")
    ]);

    renderDashboard(dataPayload.data || [], statsPayload);
    setActionMessage(
      typeof Chart === "undefined"
        ? "Live data synced, but Chart.js is unavailable so graphs are hidden."
        : "Live data synced successfully.",
      typeof Chart === "undefined" ? "error" : "success"
    );
  } catch (error) {
    setSystemStatus("Offline");
    setActionMessage(error.message, "error");
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
    await fetchJson("/api/simulate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ count: 1 })
    });

    setActionMessage("Sample ESP32 reading generated successfully.", "success");
    await refreshDashboard();
  } catch (error) {
    setActionMessage(error.message, "error");
  } finally {
    elements.simulateButton.disabled = false;
  }
}

function attachEventListeners() {
  elements.simulateButton.addEventListener("click", simulateReading);
  elements.exportButton.addEventListener("click", exportHistoryToCsv);
  elements.refreshButton.addEventListener("click", () => refreshDashboard(true));
}

function initializeApp() {
  elements.projectYear.textContent = String(new Date().getFullYear());
  attachEventListeners();

  if (typeof Chart === "undefined") {
    setActionMessage("Chart.js failed to load. Graphs are temporarily unavailable.", "error");
  } else {
    initializeCharts();
  }

  refreshDashboard(true);
  window.setInterval(() => refreshDashboard(false), POLL_INTERVAL_MS);
}

initializeApp();
