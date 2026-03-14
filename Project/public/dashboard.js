const REFRESH_INTERVAL_MS = 4000;
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
    label: "Temperature (C)",
    borderColor: "#ff7a6b",
    backgroundColor: "rgba(255, 122, 107, 0.16)"
  }
};

const chartInstances = {};

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

function renderMetrics(data) {
  updateText("voltageValue", `${data.metrics.voltage.toFixed(1)} V`);
  updateText("currentValue", `${data.metrics.current.toFixed(1)} A`);
  updateText("powerValue", `${data.metrics.power.toFixed(1)} W`);
  updateText("temperatureValue", `${data.metrics.temperature.toFixed(1)} C`);
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
          <td>${record.temperature.toFixed(2)} C</td>
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

async function refreshDashboard() {
  try {
    const response = await fetch("/api/dashboard");

    if (!response.ok) {
      throw new Error("Dashboard request failed.");
    }

    const data = await response.json();
    renderMetrics(data);
    renderAlerts(data.alerts);
    renderHistory(data.history);
    renderCharts(data);
  } catch (error) {
    renderMetrics(DEMO_DATA);
    renderHistory(DEMO_DATA.history);
    renderCharts(DEMO_DATA);
    renderInfoBanner(
      "Preview mode: live API is unavailable, so demo data is being shown."
    );
  }
}

initializeCharts();
refreshDashboard();
setInterval(refreshDashboard, REFRESH_INTERVAL_MS);
