const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const distDir = path.join(rootDir, "dist");

function removeDirectory(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.rmSync(directoryPath, {
      recursive: true,
      force: true
    });
  }
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, {
    recursive: true
  });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

removeDirectory(distDir);
copyDirectory(publicDir, distDir);

// Keep single-page routing resilient for direct refreshes on GitHub Pages.
fs.copyFileSync(path.join(distDir, "index.html"), path.join(distDir, "404.html"));
fs.writeFileSync(path.join(distDir, ".nojekyll"), "");

console.log(`GitHub Pages bundle written to ${distDir}`);
