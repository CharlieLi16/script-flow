import { defineConfig } from '@trigger.dev/sdk/v3';

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID || 'script-flow',
  runtime: 'node',
  logLevel: 'info',
  maxDuration: 600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 2,
    },
  },
  dirs: ['./trigger'],
});
