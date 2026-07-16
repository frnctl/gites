import {defineConfig, devices} from '@playwright/test';

const remoteBaseUrl=process.env.BF_TEST_BASE_URL;

export default defineConfig({
  testDir:'./tests',
  testMatch:'app.spec.mjs',
  timeout:30_000,
  fullyParallel:true,
  reporter:'line',
  use:{
    baseURL:remoteBaseUrl || 'http://127.0.0.1:4173',
    trace:'retain-on-failure'
  },
  projects:[
    {name:'desktop', use:{...devices['Desktop Chrome']}},
    {name:'mobile', use:{...devices['Pixel 7']}}
  ],
  webServer:remoteBaseUrl ? undefined : {
    command:'node scripts/serve.mjs',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:true,
    stdout:'ignore',
    stderr:'pipe'
  }
});
