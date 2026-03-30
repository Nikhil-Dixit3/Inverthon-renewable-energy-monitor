const mongoose = require("mongoose");
const createApp = require("./app");

const app = createApp();
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/renewable_energy_monitor";

async function startServer() {
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  });

  console.log("MongoDB connected successfully.");

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Renewable Energy Monitor running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start the server:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer
};
