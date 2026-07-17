// Keep the downloaded Chromium inside the project so the desktop build can
// bundle it (instead of the default global ~/.cache/puppeteer location).
const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.puppeteer-cache'),
};
