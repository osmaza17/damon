// End-to-end smoke: launches the real app with isolated state, walks the
// onboarding (team -> agent -> Claude session), model picker, file drawer,
// and Ctrl+I rename. Run: node test/e2e.js
// Uses a temp userData/.ade so it never touches your real teams or agents.
const { _electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'damon-e2e-'));
const USER_DATA = path.join(TMP, 'userdata');
const ADE_HOME = path.join(TMP, 'ade');
const shot = (n) => path.join(TMP, n + '.png');
const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };

(async () => {
  const app = await _electron.launch({
    args: ['.'],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DAMON_USER_DATA: USER_DATA, DAMON_ADE_HOME: ADE_HOME },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);

  // onboarding: team
  await page.click('#empty-action');
  await page.fill('#team-name', 'YouTube');
  await page.click('#team-create');
  await page.waitForTimeout(500);

  // onboarding: agent with a new empty repo, boots Claude
  await page.click('#empty-action');
  await page.fill('#agent-name', 'Ernest');
  await page.click('#agent-create');
  await page.waitForTimeout(15000);
  await page.screenshot({ path: shot('claude-session') });

  const dirs = fs.readdirSync(ADE_HOME);
  assert(dirs.length === 1, 'one agent repo created');
  const repoFiles = fs.readdirSync(path.join(ADE_HOME, dirs[0]));
  for (const f of ['CLAUDE.md', 'agent.md', 'user.md', 'memory.md', '.git']) {
    assert(repoFiles.includes(f), f + ' exists in agent repo');
  }

  // Ctrl+T -> picker with all models
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(600);
  assert((await page.$$eval('.model-btn', (e) => e.length)) === 6, '6 model buttons');

  // drawer lists the markdown files
  await page.click('#toggle-drawer');
  await page.waitForTimeout(400);
  const files = await page.$$eval('#file-list li', (els) => els.map((e) => e.textContent));
  assert(files.includes('agent.md') && files.includes('memory.md'), 'drawer shows agent files');

  // Ctrl+I rename
  await page.keyboard.press('Control+i');
  await page.waitForTimeout(200);
  await page.keyboard.type('Renamed session');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const titles = await page.$$eval('.tab .title', (els) => els.map((e) => e.textContent));
  assert(titles.includes('Renamed session'), 'tab renamed in place');

  // heartbeat dot present on tabs
  assert((await page.$$eval('.tab .dot', (e) => e.length)) >= 1, 'tab status dots rendered');

  // toolbar: model menu lists the 4 claude models
  await page.click('#btn-model');
  await page.waitForTimeout(200);
  assert((await page.$$eval('.popup-item', (e) => e.length)) === 4, 'model menu has 4 entries');
  await page.keyboard.press('Escape');

  // auto-switch menu toggles the setting
  await page.click('#btn-autoswitch');
  await page.waitForTimeout(200);
  await page.click('.popup-item'); // "Auto-switch enabled" toggle
  await page.waitForTimeout(400);
  assert(await page.$eval('#btn-autoswitch', (e) => e.classList.contains('on')), 'auto-switch toggled on');
  await page.click('#btn-autoswitch');
  await page.waitForTimeout(200);
  await page.click('.popup-item'); // toggle back off
  await page.waitForTimeout(200);

  // history drawer opens (empty on a fresh profile)
  await page.click('#btn-history');
  await page.waitForTimeout(200);
  assert(await page.$eval('#history-drawer', (e) => !e.classList.contains('hidden')), 'history drawer opens');
  await page.click('#btn-history');

  // settings dialog opens, shows per-account rows (read from ~/.claude), saves
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  assert(await page.$eval('#settings-dialog', (e) => e.open), 'settings dialog opens');
  await page.fill('#set-fontsize', '15');
  await page.click('#settings-dialog button[value="ok"]');
  await page.waitForTimeout(400);
  assert((await page.$eval('#zoom-label', (e) => e.textContent)) === '15px', 'font size saved to toolbar');

  // zoom buttons
  await page.click('#btn-zoom-in');
  await page.waitForTimeout(200);
  assert((await page.$eval('#zoom-label', (e) => e.textContent)) === '16px', 'zoom + works');

  // account button shows the live account (read-only; do NOT open/click the popup)
  const accText = await page.$eval('#btn-account', (e) => e.textContent);
  assert(accText.length > 0, 'account button has a label');

  await page.screenshot({ path: shot('final') });
  await app.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('E2E OK');
})().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
