// Browser tests for the page (npm run test:e2e). The game rules have their own tests (npm test).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4319',
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    // PW_CHROMIUM: use a Chromium already on the machine instead of Playwright's own download.
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  } }],
  webServer: {
    // The play-lab server (static files plus the recording API), writing games to a scratch folder.
    // Fresh each run, with its own catalog (the reason codes copied; reviews and annotations start empty).
    command: 'rm -rf .lab-test-data && mkdir -p .lab-test-data/catalog/reviews && cp catalog/reasons.json .lab-test-data/catalog/'
      + ' && LAB_CATALOG=.lab-test-data/catalog python3 server.py --port 4319 --host 127.0.0.1 --data .lab-test-data',
    url: 'http://127.0.0.1:4319/index.html',
    reuseExistingServer: false,   // never test some other server that happens to hold the port
  },
});
