import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory ../src/VoiceLive.Web/wwwroot",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
