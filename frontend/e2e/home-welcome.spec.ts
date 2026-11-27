import { expect, test } from '@playwright/test';

// 起步任务与 src/components/message/EmptyHero.tsx 的 QUICK_CHIPS 保持一致
const examples = [
  ['梳理项目结构', '请梳理这个项目的目录结构和主要模块，说明各模块的职责和它们之间的调用关系，整理成一份简明的项目导览。这一步只读，先不要修改任何文件。'],
  ['修复一个问题', '帮我排查并修复一个问题：先阅读相关代码和最近的改动，定位原因并说明依据，再实施修复，完成后运行相关测试验证。'],
  ['补单元测试', '请查看最近的代码改动，找出其中缺少测试覆盖的关键逻辑，补上单元测试，并运行测试确认全部通过。'],
  ['跑测试并总结', '运行这个项目的测试，把失败的用例逐个分析原因，区分是代码问题还是环境问题，并给出修复建议。先不要改动代码。'],
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('skycode.workbench.enabled', 'true');
    localStorage.setItem('skycode.workbench.default-view', 'simple');
  });
  // No live backend or model calls: startup reads only, with a newer session in the list.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const body = path === '/api/sessions'
      ? { sessions: [{ id: 'newest-session', title: '最新会话', model: 'test', workingDirectory: '/workspace', messageCount: 1 }], hasMore: false }
      : path.endsWith('/workbench/current') ? null
      : path === '/api/skills' ? [] : {};
    return route.fulfill({ json: body });
  });
  await page.route('**/ws/**', route => route.abort());
  page.on('dialog', dialog => dialog.accept());
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`welcome and editable examples at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
    });
    await page.goto('/');
    const heading = page.getByRole('heading', { name: '今天想创造什么？' });
    await expect(heading).toBeVisible();
    const hero = heading.locator('..');
    await expect(hero.getByText('SkyCode', { exact: true })).toBeVisible();
    // 品牌标现在是无障碍隐藏的内联 SVG（配色跟随强调色），不再是 <img>
    await expect(hero.locator('svg[aria-hidden="true"]').first()).toBeVisible();
    await expect(hero.getByText('描述任务，SkyCode 会读代码、改文件、跑命令，过程随时可查')).toBeVisible();
    await expect(hero.getByText(/APOS/)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('session-list-updated')));
    expect(await page.evaluate(() => sessionStorage.getItem('skycode.activeSessionId'))).toBeNull();
    await expect(heading).toBeVisible();
    const input = page.getByRole('textbox', { name: '输入消息' });
    for (const [label, prompt] of examples) {
      const button = hero.getByRole('button', { name: label, exact: true });
      await expect(button).toBeInViewport();
      await button.click();
      await expect(input).toHaveValue(prompt);
      await expect(input).toBeFocused();
      await input.fill('可以自行修改');
      await expect(input).toHaveValue('可以自行修改');
      await input.fill('');
    }
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`welcome-${viewport.width}.png`) });
  });
}

test('a committed selection survives reload; clearing it returns home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想创造什么？' })).toBeVisible();
  // Exercise the existing commit/persistence path, not an invented navigation state.
  await page.evaluate(() => window.__e2eStores!.sessionStore.getState().resumeSession('chosen-session'));
  await expect(page.getByText('当前任务', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('当前任务', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__e2eStores!.sessionStore.getState().sessionId)).toBe('chosen-session');
  await page.evaluate(() => window.__e2eStores!.sessionStore.getState().resumeSession(''));
  await expect(page.getByRole('heading', { name: '今天想创造什么？' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('skycode.activeSessionId'))).toBeNull();
});

for (const width of [390, 900]) {
  test(`menu opens the session list directly at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await expect(page.getByRole('main').getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '搜索任务或文件夹' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '侧边栏' })).toHaveCount(0);
    await expect(page.locator('aside')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`session-menu-${width}.png`) });
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByRole('heading', { name: '今天想创造什么？' })).toBeVisible();
  });
}

for (const width of [390, 900, 1440]) {
  test(`logo clears the selection and returns home at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今天想创造什么？' })).toBeVisible();
    await page.evaluate(() => window.__e2eStores!.sessionStore.getState().resumeSession('chosen-session'));
    await expect(page.getByText('当前任务', { exact: true })).toBeVisible();
    if (width < 1024) await page.getByRole('button', { name: '打开会话列表' }).click();
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
    });
    await page.getByRole('button', { name: '返回首页' }).click();
    await expect(page.getByRole('heading', { name: '今天想创造什么？' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('skycode.activeSessionId'))).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: '今天想创造什么？' })).toBeVisible();
    expect(writes).toEqual([]);
  });
}
