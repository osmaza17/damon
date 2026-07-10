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

  await app.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('E2E OK');
})().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
