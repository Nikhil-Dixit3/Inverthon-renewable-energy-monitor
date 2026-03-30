const assert = require("node:assert/strict");

const createApp = require("../server/app");
const { createApiRouter } = require("../server/routes/api");

function cloneRecord(record) {
  if (!record) {
    return null;
  }

  return {
    ...record,
    timestamp: new Date(record.timestamp)
  };
}

function sortRecords(records, sortSpec = {}) {
  const [field, direction] = Object.entries(sortSpec)[0] || ["timestamp", -1];
  const multiplier = direction >= 0 ? 1 : -1;

  return [...records].sort((left, right) => {
    const leftValue =
      left[field] instanceof Date ? left[field].getTime() : left[field];
    const rightValue =
      right[field] instanceof Date ? right[field].getTime() : right[field];

    if (leftValue < rightValue) {
      return -1 * multiplier;
    }

    if (leftValue > rightValue) {
      return 1 * multiplier;
    }

    return 0;
  });
}

function matchesFilter(record, filter = {}) {
  if (!filter || !Object.keys(filter).length) {
    return true;
  }

  if (filter.timestamp && filter.timestamp.$gte) {
    return new Date(record.timestamp).getTime() >= new Date(filter.timestamp.$gte).getTime();
  }

  return true;
}

function createManyQuery(store, filter = {}) {
  let result = store.filter((record) => matchesFilter(record, filter));

  return {
    sort(sortSpec) {
      result = sortRecords(result, sortSpec);
      return this;
    },
    limit(limitValue) {
      result = result.slice(0, limitValue);
      return this;
    },
    lean() {
      return Promise.resolve(result.map(cloneRecord));
    }
  };
}

function createOneQuery(store, filter = {}) {
  let result = store.filter((record) => matchesFilter(record, filter));

  return {
    sort(sortSpec) {
      result = sortRecords(result, sortSpec);
      return this;
    },
    lean() {
      return Promise.resolve(cloneRecord(result[0] || null));
    }
  };
}

function createMockEnergyModel() {
  const store = [];
  let nextId = 1;

  const EnergyModel = {
    create: async (payload) => {
      const record = {
        _id: String(nextId++),
        ...payload,
        timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date()
      };

      store.push(record);
      return cloneRecord(record);
    },
    insertMany: async (payloads) => Promise.all(payloads.map((payload) => EnergyModel.create(payload))),
    find: (filter = {}) => createManyQuery(store, filter),
    findOne: (filter = {}) => createOneQuery(store, filter)
  };

  return EnergyModel;
}

function buildTestContext() {
  const EnergyModel = createMockEnergyModel();
  const app = createApp({
    apiRouter: createApiRouter({ EnergyModel })
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();

      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          })
      });
    });
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const json = await response.json();

  return {
    status: response.status,
    json
  };
}

async function runCase(name, testFn) {
  try {
    await testFn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  await runCase("serves the dashboard shell and SPA fallback", async () => {
    const context = await buildTestContext();

    try {
      const homeResponse = await fetch(context.baseUrl);
      const homeHtml = await homeResponse.text();
      assert.equal(homeResponse.status, 200);
      assert.match(homeHtml, /Renewable Energy Monitor/);
      assert.match(homeHtml, /welcomeScreen/);

      const fallbackResponse = await fetch(`${context.baseUrl}/deep/link/check`);
      const fallbackHtml = await fallbackResponse.text();
      assert.equal(fallbackResponse.status, 200);
      assert.match(fallbackHtml, /dashboardApp/);
    } finally {
      await context.close();
    }
  });

  await runCase("stores sensor data and returns it from the history endpoint", async () => {
    const context = await buildTestContext();

    try {
      const createResponse = await requestJson(`${context.baseUrl}/api/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          voltage: 220,
          current: 5,
          temperature: 34,
          inputPower: 1210
        })
      });

      assert.equal(createResponse.status, 201);
      assert.equal(createResponse.json.data.power, 1100);

      const listResponse = await requestJson(
        `${context.baseUrl}/api/data?limit=20&order=asc`
      );

      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.json.total, 1);
      assert.equal(listResponse.json.data[0].voltage, 220);
      assert.equal(listResponse.json.latest.power, 1100);
    } finally {
      await context.close();
    }
  });

  await runCase("rejects invalid sensor payloads with a 400 response", async () => {
    const context = await buildTestContext();

    try {
      const response = await requestJson(`${context.baseUrl}/api/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          current: 8.4,
          temperature: 37.5
        })
      });

      assert.equal(response.status, 400);
      assert.match(response.json.details, /voltage is required/i);
    } finally {
      await context.close();
    }
  });

  await runCase("simulation populates readings and analytics successfully", async () => {
    const context = await buildTestContext();

    try {
      const simulateResponse = await requestJson(`${context.baseUrl}/api/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          count: 12,
          intervalMinutes: 5
        })
      });

      assert.equal(simulateResponse.status, 201);
      assert.equal(simulateResponse.json.data.length, 12);

      const listResponse = await requestJson(
        `${context.baseUrl}/api/data?limit=20&order=asc`
      );
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.json.total, 12);

      const statsResponse = await requestJson(`${context.baseUrl}/api/stats`);
      assert.equal(statsResponse.status, 200);
      assert.equal(statsResponse.json.systemStatus, "Online");
      assert.equal(statsResponse.json.analytics.samplesToday, 12);
      assert.ok(statsResponse.json.analytics.energyTodayWh >= 0);
      assert.equal(statsResponse.json.onlineWindowSeconds, 20);
    } finally {
      await context.close();
    }
  });

  await runCase("fault simulation surfaces critical faults in analytics", async () => {
    const context = await buildTestContext();

    try {
      const simulateResponse = await requestJson(
        `${context.baseUrl}/api/simulate/fault`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      assert.equal(simulateResponse.status, 201);

      const statsResponse = await requestJson(`${context.baseUrl}/api/stats`);
      assert.equal(statsResponse.status, 200);
      assert.equal(statsResponse.json.health.highestSeverity, "critical");
      assert.ok(statsResponse.json.faults.length >= 3);
      assert.ok(
        statsResponse.json.faults.some((fault) => fault.code === "FLT-UNDERVOLTAGE")
      );
      assert.ok(
        statsResponse.json.faults.some(
          (fault) => fault.code === "FLT-OVERCURRENT" || fault.code === "FLT-THERMAL"
        )
      );
    } finally {
      await context.close();
    }
  });

  await runCase("health endpoint reports API availability without MongoDB", async () => {
    const context = await buildTestContext();

    try {
      const response = await requestJson(`${context.baseUrl}/api/health`);

      assert.equal(response.status, 200);
      assert.equal(response.json.api, "online");
      assert.equal(response.json.database, "disconnected");
    } finally {
      await context.close();
    }
  });

  console.log("Smoke tests completed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
