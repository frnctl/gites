import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir:'./tests',
  testMatch:'authenticated-app.spec.mjs',
  timeout:90_000,
  fullyParallel:false,
  workers:1,
  reporter:'line',
  use:{
    baseURL:'http://127.0.0.1:4173',
    trace:'retain-on-failure'
  },
  projects:[
    {name:'authenticated-desktop', use:{...devices['Desktop Chrome']}}
  ],
  webServer:{
    command:'node scripts/serve.mjs',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:false,
    stdout:'ignore',
    stderr:'pipe'
  }
});
