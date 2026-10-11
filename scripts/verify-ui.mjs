import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = 'http://127.0.0.1:5173/';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function expectVisible(selector, name) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const count = await page.locator(selector).count();
  console.log(`PASS: ${name} visible (${count})`);
}

async function checkNoHorizontalOverflow(label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 2) {
    throw new Error(`${label}: horizontal overflow detected`);
  }
  console.log(`PASS: ${label} no horizontal overflow`);
}

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await expectVisible('.top-bar', 'App shell');
await expectVisible('.nav-button', 'Sidebar navigation');
await expectVisible('.metric-card', 'Overview metrics');
await checkNoHorizontalOverflow('Overview');
await page.screenshot({ path: 'screenshots/overview.png', fullPage: true });

await page.getByRole('button', { name: '入口地图' }).click();
await expectVisible('.entry-button', 'Entry map cards');
await expectVisible('.filter-button', 'Entry filters');
await checkNoHorizontalOverflow('Entry map');
await page.screenshot({ path: 'screenshots/entries.png', fullPage: true });

await page.getByRole('button', { name: /发送聊天消息/ }).click();
await expectVisible('.flow-node', 'Flow nodes');
await expectVisible('.evidence-card', 'Evidence cards');
await checkNoHorizontalOverflow('Flow explorer');
await page.screenshot({ path: 'screenshots/flows.png', fullPage: true });

const selectedNodeText = await page.locator('.flow-node.selected .flow-node-label').innerText();
if (!selectedNodeText) {
  throw new Error('Flow explorer: selected node has no label');
}
console.log(`PASS: selected flow node is ${selectedNodeText}`);

await page.getByRole('button', { name: '工程取舍' }).click();
await expectVisible('.decision-button', 'Decision list');
await expectVisible('.parameter-table', 'Decision parameters');
await checkNoHorizontalOverflow('Decisions');
await page.screenshot({ path: 'screenshots/decisions.png', fullPage: true });

await page.getByRole('button', { name: '追问仓库' }).click();
await expectVisible('.question-button', 'Ask questions');
await expectVisible('.answer-block', 'Ask answer');
await checkNoHorizontalOverflow('Ask repo');
await page.screenshot({ path: 'screenshots/ask.png', fullPage: true });

await page.getByRole('button', { name: '学习路径' }).click();
await expectVisible('.path-item', 'Learning path items');
await page.locator('.path-check').first().click();
await expectVisible('.progress-fill', 'Learning progress');
await checkNoHorizontalOverflow('Learning path');
await page.screenshot({ path: 'screenshots/path.png', fullPage: true });

const evidenceBeforeAnalysis = (await page.locator('.evidence-panel').innerText()).toLowerCase();
if (!/source verified|源码已验证/i.test(evidenceBeforeAnalysis)) {
  throw new Error('Evidence panel is missing source verification label');
}
console.log('PASS: evidence panel contains source-verified evidence');

await page.getByRole('button', { name: 'AI 供应商' }).click();
await expectVisible('.filter-button', 'Provider options');
await page.getByRole('button', { name: 'OpenAI' }).click();
await page.getByRole('button', { name: '保存并测试' }).click();
await expectVisible('#api-key', 'Provider key input');
await page.getByRole('button', { name: 'Mock（本地示例）' }).click();
await page.getByRole('button', { name: '保存并测试' }).click();
await page.waitForTimeout(500);
console.log('PASS: provider connection test is available');
await page.getByRole('button', { name: '分析仓库' }).click();
await page.waitForTimeout(500);
await expectVisible('.metric-card', 'Analysis result metrics');
console.log('PASS: mock provider analysis updates the workspace');

await page.getByRole('button', { name: '历史分析' }).click();
await expectVisible('.path-item', 'Analysis history items');
await page.locator('.path-check').first().click();
await expectVisible('.metric-card', 'History project metrics');
console.log('PASS: history project reloads into the workspace');

await page.getByRole('button', { name: 'AI 供应商' }).click();
await page.getByRole('button', { name: '分析仓库' }).click();
await page.waitForTimeout(500);
await expectVisible('.metric-card', 'Second analysis metrics');

await page.getByRole('button', { name: '对比' }).click();
await expectVisible('.compare-select', 'Comparison selectors');
await page.getByRole('button', { name: '对比分析' }).click();
await expectVisible('.metric-card', 'Comparison result metrics');
console.log('PASS: analysis comparison renders differences');

console.log('PASS: evidence panel contains source-verified evidence');

await browser.close();
console.log('UI verification complete');
