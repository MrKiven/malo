const electron = require("electron");
console.log("type:", typeof electron);
console.log("app:", typeof electron.app);
console.log("value:", String(electron).slice(0, 100));
if (electron.app) {
  electron.app.quit();
} else {
  process.exit(0);
}
