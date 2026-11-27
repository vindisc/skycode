/**
 * Offline browser regression for message reading surfaces.
 * npm run test:theme-regression
 *
 * Bundles the real renderers and full styles in memory, replacing only stores.
 * No application server, API, user storage or host clipboard is used. HTTP(S)
 * requests are blocked; failure screenshots go to a temporary directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
// Use Vite's installed build dependency rather than downloading another tool.
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
const configMock = `
import {useSyncExternalStore} from 'react';
let state={theme:{mode:'light',accentColor:'#12967F'}};
const listeners=new Set();
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
export function useConfigStore(selector){return useSyncExternalStore(subscribe,()=>selector(state))}
useConfigStore.setState=update=>{state={...state,...update};for(const fn of listeners)fn()};
`;
const bundle = await esbuild.build({
    absWorkingDir: frontend,
    entryPoints: ['tests/browser/theme-fixture.tsx'],
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': path.join(frontend, 'src') },
    loader: { '.svg': 'dataurl' },
    plugins: [{ name: 'isolated-stores', setup(build) {
        build.onResolve({ filter: /^@\/store\/(configStore|sessionStore)$/ }, args => ({
            path: args.path.endsWith('configStore') ? 'config' : 'session', namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
            contents: args.path === 'config' ? configMock : 'export const useSessionStore=selector=>selector({sessionId:null});',
            loader: 'js', resolveDir: frontend,
        }));
    } }],
});
const styleDir = path.join(frontend, 'src/styles');
let sourceCss = await fs.readFile(path.join(styleDir, 'globals.css'), 'utf8');
for (const match of [...sourceCss.matchAll(/@import ['"]\.\/(.*?)['"];?/g)]) {
    sourceCss = sourceCss.replace(match[0], await fs.readFile(path.join(styleDir, match[1]), 'utf8'));
}
sourceCss += await fs.readFile(path.join(styleDir, 'interface-refinements.css'), 'utf8');
const tailwindConfig = loadConfig(path.join(frontend, 'tailwind.config.ts'));
tailwindConfig.content = [path.join(frontend, 'src/**/*.{ts,tsx}'), path.join(frontend, 'tests/browser/theme-fixture.tsx')];
const css = (await postcss([tailwindcss(tailwindConfig)]).process(sourceCss, { from: undefined })).css;
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'skycode-theme-regression-'));
const browser = await chromium.launch({ headless: true });
try {
    for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [];
        const businessRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (/\/api\/|\/ws\//.test(route.request().url())) businessRequests.push(route.request().url());
            return route.abort();
        });
        await page.setContent(`<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        for (const mode of ['light', 'dark']) {
            const label = `${mode}-${width}`;
            try {
                await page.evaluate((mode) => window.configureTheme(mode), mode);
                await expect(page.locator('main')).toHaveAttribute('data-theme', mode);
                await expect(page.locator('#long button', { hasText: 'Enable highlighting' })).toBeVisible();
                await expect(page.locator('#diagram [role="region"] svg')).toBeVisible();
                await expect(page.locator('#error')).toContainText('Mermaid 渲染失败');
                await expect(page.locator('#loading')).toContainText('Mermaid 图表加载中');
                await page.locator('#long button', { hasText: 'Enable highlighting' }).click();
                await expect(page.locator('#long .react-syntax-highlighter-line-number')).toHaveCount(100);
                await page.locator('#long button[aria-label="Copy code"]').click();
                assert.ok((await page.evaluate(() => window.copiedText)).startsWith('// A readable explanation'));
                await page.locator('#diagram button[title="复制 SVG"]').click();
                assert.ok((await page.evaluate(() => window.copiedText)).includes('<svg'));
                const download = page.waitForEvent('download');
                await page.locator('#diagram button[title="下载 PNG"]').click();
                assert.equal((await download).suggestedFilename(), 'mermaid-diagram.png');
                await page.locator('#mixed [data-testid="message-copy-all-button"]').click();
                assert.ok((await page.evaluate(() => window.copiedText)).includes('图文消息'));
                await page.locator('#mixed [aria-label="Zoom image"]').click();
                await expect(page.locator('[aria-label="Close zoom"]')).toBeVisible();
                const overlay = page.locator('[aria-label="Close zoom"]').locator('..').locator('..');
                const box = await overlay.boundingBox();
                assert.ok(box && box.x === 0 && box.y === 0 && box.width === width && box.height === 900,
                    `${label}: image preview does not fill the viewport`);
                const previousCopies = await page.evaluate(() => window.copiedImages);
                await page.locator('[aria-label="Copy image"]').click();
                await expect.poll(() => page.evaluate(() => window.copiedImages)).toBe(previousCopies + 1);
                await page.locator('[aria-label="Close zoom"]').click();
                await page.locator('#disclosure button[aria-expanded]').click();
                await expect(page.locator('#disclosure .text-block')).toBeVisible();
                await page.locator('#disclosure button[aria-expanded]').click();
                assert.deepEqual(errors, [], 'Unexpected browser exceptions');
                assert.deepEqual(businessRequests, [], 'Fixture attempted to contact a business service');
                console.log(`PASS ${label}`);
            } catch (error) {
                await page.screenshot({ path: path.join(artifacts, `${label}.png`), fullPage: true });
                throw new Error(`${label}: ${error.message}\nScreenshot directory: ${artifacts}`, { cause: error });
            }
        }
        await context.close();
    }
    console.log('Theme regression passed: 4 scenarios (light / dark × 1440 / 390); no business requests.');
} finally {
    await browser.close();
}
