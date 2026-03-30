const express = require("express");
const path = require("path");

const defaultApiRouter = require("./routes/api");

function createApp(options = {}) {
  const apiRouter = options.apiRouter || defaultApiRouter;
  const staticDir = options.staticDir || path.join(__dirname, "..", "public");
  const app = express();

  // Core middleware for JSON APIs and static dashboard hosting.
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(staticDir));

  app.use("/api", apiRouter);

  app.get("*", (req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
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

  return app;
}

module.exports = createApp;
