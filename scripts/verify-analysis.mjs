import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = 'http://127.0.0.1:5173/';
const repositoryUrl = 'https://github.com/deepseek-ai/deepseek-harness';
const modelName = 'DeepSeek-V4-Flash-0731';
const apiBase = 'http://127.0.0.1:3001';

mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '自定义供应商' }).click();
await page.locator('#provider-endpoint').waitFor({ state: 'visible', timeout: 10_000 });

const modelValue = await page.locator('#model').inputValue();
if (modelValue !== modelName) {
  await page.locator('#model').fill(modelName);
}
await page.locator('#repo-url').fill(repositoryUrl);

console.log('Starting real AI analysis...');
const [jobResponse] = await Promise.all([
  page.waitForResponse((response) => response.url().endsWith('/api/analyze') && response.request().method() === 'POST'),
  page.getByRole('button', { name: '分析仓库' }).click(),
]);
const job = await jobResponse.json();
if (!job.jobId) {
  throw new Error(`Analysis job was not created: ${JSON.stringify(job)}`);
}
console.log(`job: ${job.jobId}`);

const deadline = Date.now() + 10 * 60 * 1000;
let lastStage = '';
while (Date.now() < deadline) {
  let status;
  try {
    const response = await fetch(`${apiBase}/api/analysis/${job.jobId}`);
    status = await response.json();
  } catch {
    status = {};
  }
  const stage = status.stage ?? '';
  const progress = status.progress ?? 0;
  if (stage !== lastStage) {
    console.log(`stage (${progress}%): ${stage}`);
    lastStage = stage;
  }

  if (status.status === 'error') {
    console.error(`Analysis failed: ${status.error ?? 'Unknown error'}`);
    await page.screenshot({ path: 'screenshots/analysis-error.png', fullPage: true });
    await browser.close();
    process.exit(1);
  }

  if (status.status === 'complete') {
    await page.locator('.metric-card').first().waitFor({ state: 'visible', timeout: 15_000 });
    console.log('Analysis complete: metric cards visible');
    await page.screenshot({ path: 'screenshots/analysis-result.png', fullPage: true });
    await browser.close();
    process.exit(0);
  }

  await page.waitForTimeout(1000);
}

console.error('Timed out waiting for analysis result');
await page.screenshot({ path: 'screenshots/analysis-timeout.png', fullPage: true });
await browser.close();
process.exit(1);
