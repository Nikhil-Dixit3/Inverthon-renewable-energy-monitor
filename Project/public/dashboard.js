const DEGREE_C = "\u00B0C";
const DEFAULT_REFRESH_INTERVAL_MS = 4000;

const DEMO_DATA = {
  metrics: {
    voltage: 228.9,
    current: 9.1,
    power: 1701.3,
    temperature: 30.0,
    status: "Online"
  },
  analytics: {
    totalEnergyTodayWh: 703.73,
    monthlyEnergyKWh: 0.7,
    efficiency: 87.72
  },
  alerts: [],
  history: Array.from({ length: 20 }, (_, index) => {
    const time = new Date(Date.now() - index * 60000);
    return {
      time,
      voltage: 224 + Math.sin(index / 4) * 6,
      current: 8 + Math.cos(index / 5) * 1.2,
      power: (224 + Math.sin(index / 4) * 6) * (8 + Math.cos(index / 5) * 1.2) * 0.82,
      temperature: 34 + Math.sin(index / 6) * 4
    };
  }),
  charts: {
    labels: Array.from({ length: 30 }, (_, index) =>
      new Date(Date.now() - (29 - index) * 60000).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    ),
    voltage: Array.from({ length: 30 }, (_, index) => 224 + Math.sin(index / 4) * 6),
    current: Array.from({ length: 30 }, (_, index) => 8 + Math.cos(index / 5) * 1.2),
    power: Array.from({ length: 30 }, (_, index) => {
      const voltage = 224 + Math.sin(index / 4) * 6;
      const current = 8 + Math.cos(index / 5) * 1.2;
      return voltage * current * 0.82;
    }),
    temperature: Array.from({ length: 30 }, (_, index) => 34 + Math.sin(index / 6) * 4)
  },
  updatedAt: new Date().toISOString(),
  settings: {
    siteName: "RenewGrid",
    operatorName: "Admin Station",
    operatorRole: "Plant Supervisor",
    refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
    voltageLowThreshold: 210,
    currentHighThreshold: 15,
    temperatureHighThreshold: 60,
    onlineWindowSeconds: 15,
    alertsEnabled: true
  },
  mockMode: true
};

const chartConfig = {
  voltage: {
    elementId: "voltageChart",
    label: "Voltage (V)",
    borderColor: "#2bb4ff",
    backgroundColor: "rgba(43, 180, 255, 0.16)"
  },
  current: {
    elementId: "currentChart",
    label: "Current (A)",
    borderColor: "#59e3a7",
    backgroundColor: "rgba(89, 227, 167, 0.16)"
  },
  power: {
    elementId: "powerChart",
    label: "Power (W)",
    borderColor: "#f4c95d",
    backgroundColor: "rgba(244, 201, 93, 0.16)"
  },
  temperature: {
    elementId: "temperatureChart",
    label: `Temperature (${DEGREE_C})`,
    borderColor: "#ff7a6b",
    backgroundColor: "rgba(255, 122, 107, 0.16)"
  }
};

const chartInstances = {};

const state = {
  dashboardStarted: false,
  refreshTimerId: null,
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  currentView: "dashboard",
  settings: { ...DEMO_DATA.settings }
};

function createLineChart(canvasId, label, borderColor, backgroundColor) {
  const ctx = document.getElementById(canvasId).getContext("2d");

  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor,
          backgroundColor,
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#edf6ff"
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#92a8c1" },
          grid: { color: "rgba(146, 168, 193, 0.1)" }
        },
        y: {
          ticks: { color: "#92a8c1" },
          grid: { color: "rgba(146, 168, 193, 0.1)" }
        }
      }
    }
  });
}

function initializeCharts() {
  Object.entries(chartConfig).forEach(([key, config]) => {
    chartInstances[key] = createLineChart(
      config.elementId,
      config.label,
      config.borderColor,
      config.backgroundColor
    );
  });
}

function updateChart(chart, labels, values) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.update();
}

function updateText(id, value) {
  document.getElementById(id).textContent = value;
}

function showMessage(id, message, tone = "muted") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = `helper-text helper-text-${tone}`;
}

async function apiFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.details || "Request failed.";
    const requestError = new Error(message);
    requestError.status = response.status;
    throw requestError;
  }

  return payload;
}

function applySettings(settings) {
  state.settings = {
    ...state.settings,
    ...settings
  };

  updateText("brandSiteName", state.settings.siteName);
  updateText("sidebarOperatorName", state.settings.operatorName);
  updateText("sidebarOperatorRole", state.settings.operatorRole);
  updateText("summarySiteName", state.settings.siteName);
  updateText("summaryRefresh", `${state.settings.refreshIntervalMs} ms`);
  updateText(
    "summaryAlerts",
    state.settings.alertsEnabled ? "Enabled" : "Disabled"
  );

  document.getElementById("siteNameInput").value = state.settings.siteName;
  document.getElementById("refreshIntervalInput").value =
    state.settings.refreshIntervalMs;
  document.getElementById("operatorNameInput").value =
    state.settings.operatorName;
  document.getElementById("operatorRoleInput").value =
    state.settings.operatorRole;
  document.getElementById("voltageThresholdInput").value =
    state.settings.voltageLowThreshold;
  document.getElementById("currentThresholdInput").value =
    state.settings.currentHighThreshold;
  document.getElementById("temperatureThresholdInput").value =
    state.settings.temperatureHighThreshold;
  document.getElementById("onlineWindowInput").value =
    state.settings.onlineWindowSeconds;
  document.getElementById("alertsEnabledInput").checked =
    state.settings.alertsEnabled;

  state.refreshIntervalMs = Number(state.settings.refreshIntervalMs);
  restartAutoRefresh();
}

function renderMetrics(data) {
  updateText("voltageValue", `${data.metrics.voltage.toFixed(1)} V`);
  updateText("currentValue", `${data.metrics.current.toFixed(1)} A`);
  updateText("powerValue", `${data.metrics.power.toFixed(1)} W`);
  updateText("temperatureValue", `${data.metrics.temperature.toFixed(1)} ${DEGREE_C}`);
  updateText("systemStatusValue", data.metrics.status);
  updateText(
    "energyTodayValue",
    `${data.analytics.totalEnergyTodayWh.toFixed(2)} Wh`
  );
  updateText(
    "energyMonthValue",
    `${data.analytics.monthlyEnergyKWh.toFixed(2)} kWh`
  );
  updateText(
    "efficiencyValue",
    data.analytics.efficiency === null
      ? "--"
      : `${data.analytics.efficiency.toFixed(2)}%`
  );
  updateText(
    "lastUpdated",
    new Date(data.updatedAt).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium"
    })
  );

  const statusBadge = document.getElementById("systemStatusBadge");
  statusBadge.textContent = data.metrics.status;
  statusBadge.className =
    data.metrics.status === "Online"
      ? "status-pill status-online"
      : "status-pill status-offline";
}

function renderAlerts(alerts) {
  const alertBanner = document.getElementById("alertBanner");

  if (!alerts.length) {
    alertBanner.classList.add("hidden");
    alertBanner.textContent = "";
    return;
  }

  alertBanner.classList.remove("hidden");
  alertBanner.textContent = alerts.join(" ");
}

function renderInfoBanner(message) {
  const alertBanner = document.getElementById("alertBanner");
  alertBanner.classList.remove("hidden");
  alertBanner.textContent = message;
}

function renderHistory(history) {
  const tableBody = document.getElementById("historyTableBody");

  if (!history.length) {
    tableBody.innerHTML =
      '<tr><td colspan="5" class="empty-state">No records available yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = history
    .map(
      (record) => `
        <tr>
          <td>${new Date(record.time).toLocaleString("en-IN")}</td>
          <td>${record.voltage.toFixed(2)} V</td>
          <td>${record.current.toFixed(2)} A</td>
          <td>${record.power.toFixed(2)} W</td>
          <td>${record.temperature.toFixed(2)} ${DEGREE_C}</td>
        </tr>
      `
    )
    .join("");
}

function renderCharts(data) {
  updateChart(chartInstances.voltage, data.charts.labels, data.charts.voltage);
  updateChart(chartInstances.current, data.charts.labels, data.charts.current);
  updateChart(chartInstances.power, data.charts.labels, data.charts.power);
  updateChart(
    chartInstances.temperature,
    data.charts.labels,
    data.charts.temperature
  );
}

function updateSessionUI() {
  updateText("sessionUserDisplay", "Open Access");
  updateText("accountNameValue", "Open Dashboard");
  updateText("accountRoleValue", "No login required");
}

function setActiveView(viewName) {
  state.currentView = viewName;

  document.querySelectorAll(".app-view").forEach((view) => {
    view.classList.toggle("hidden", view.id !== `${viewName}View`);
  });

  document.querySelectorAll("[data-view]").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === viewName);
  });
}

async function refreshDashboard() {
  try {
    const data = await apiFetch("/api/dashboard");
    renderMetrics(data);
    renderAlerts(data.alerts);
    renderHistory(data.history);
    renderCharts(data);

    if (data.settings) {
      applySettings(data.settings);
    }
  } catch (error) {
    renderMetrics(DEMO_DATA);
    renderHistory(DEMO_DATA.history);
    renderCharts(DEMO_DATA);
    applySettings(DEMO_DATA.settings);
    renderInfoBanner(
      "Preview mode: live API is unavailable, so demo data is being shown."
    );
  }
}

function restartAutoRefresh() {
  if (!state.dashboardStarted) {
    return;
  }

  if (state.refreshTimerId) {
    clearInterval(state.refreshTimerId);
  }

  state.refreshTimerId = setInterval(refreshDashboard, state.refreshIntervalMs);
}

function startDashboard() {
  if (state.dashboardStarted) {
    return;
  }

  state.dashboardStarted = true;
  initializeCharts();
  restartAutoRefresh();
  refreshDashboard();
}

async function loadSettings() {
  try {
    const settings = await apiFetch("/api/settings");
    applySettings(settings);
  } catch (error) {
    applySettings(DEMO_DATA.settings);
  }
}

async function showDashboard() {
  document.getElementById("welcomeScreen").classList.add("hidden");
  document.getElementById("dashboardApp").classList.remove("hidden");
  setActiveView("dashboard");
  await loadSettings();
  startDashboard();
}

async function handleSettingsSubmit(event) {
  event.preventDefault();

  const payload = {
    siteName: document.getElementById("siteNameInput").value.trim(),
    refreshIntervalMs: Number(
      document.getElementById("refreshIntervalInput").value
    ),
    operatorName: document.getElementById("operatorNameInput").value.trim(),
    operatorRole: document.getElementById("operatorRoleInput").value.trim(),
    voltageLowThreshold: Number(
      document.getElementById("voltageThresholdInput").value
    ),
    currentHighThreshold: Number(
      document.getElementById("currentThresholdInput").value
    ),
    temperatureHighThreshold: Number(
      document.getElementById("temperatureThresholdInput").value
    ),
    onlineWindowSeconds: Number(
      document.getElementById("onlineWindowInput").value
    ),
    alertsEnabled: document.getElementById("alertsEnabledInput").checked
  };

  try {
    const settings = await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    applySettings(settings);
    showMessage("settingsMessage", "Settings saved successfully.", "success");
    await refreshDashboard();
  } catch (error) {
    showMessage("settingsMessage", error.message, "error");
  }
}

function handleResetSettings() {
  applySettings(state.settings);
  showMessage("settingsMessage", "Form reset to the latest saved settings.");
}

function logout() {
  document.getElementById("dashboardApp").classList.add("hidden");
  document.getElementById("welcomeScreen").classList.remove("hidden");
  setActiveView("dashboard");
}

function bindEvents() {
  document
    .getElementById("enterDashboardButton")
    .addEventListener("click", showDashboard);

  document
    .querySelectorAll("[data-view]")
    .forEach((button) =>
      button.addEventListener("click", () => setActiveView(button.dataset.view))
    );

  document
    .getElementById("openSettingsButton")
    .addEventListener("click", () => setActiveView("settings"));

  document
    .getElementById("backToDashboardButton")
    .addEventListener("click", () => setActiveView("dashboard"));

  document
    .getElementById("settingsForm")
    .addEventListener("submit", handleSettingsSubmit);

  document
    .getElementById("resetSettingsButton")
    .addEventListener("click", handleResetSettings);

  document
    .getElementById("topbarLogoutButton")
    .addEventListener("click", logout);

  document
    .getElementById("settingsLogoutButton")
    .addEventListener("click", logout);
}

function initializeApp() {
  bindEvents();
  applySettings(state.settings);
  updateSessionUI();
}

initializeApp();
