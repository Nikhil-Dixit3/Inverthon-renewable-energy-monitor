const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const apiRouter = require("./routes/api");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/renewable_energy_monitor";

// Core middleware for JSON APIs and static dashboard hosting.
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", apiRouter);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Unexpected server error."
  });
});

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });

    console.log("MongoDB connected successfully.");

    app.listen(PORT, () => {
      console.log(`Renewable Energy Monitor running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start the server:", error.message);
    process.exit(1);
  }
}

startServer();
