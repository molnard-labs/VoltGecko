import { defineConfig, devices } from '@playwright/test';

const browserName = process.env.PLAYWRIGHT_BROWSER === 'webkit' ? 'webkit' : 'chromium';

export default defineConfig({
  testDir: './e2e',
  // The other specs exercise the retained, previous React application.
  testMatch: 'new-planner.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'tmp/playwright-results',
  use: {
    ...devices[browserName === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1512, height: 982 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    launchOptions: browserName === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
  },
  projects: [{ name: browserName, use: { browserName } }],
  webServer: [...(process.env.PLAYWRIGHT_BASE_URL ? [] : [{
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  }]), {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  }],
});
