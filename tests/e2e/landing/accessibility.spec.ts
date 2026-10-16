import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
test('landing passes axe WCAG AA at phone width', async ({page}) => {
  await page.goto('/');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as {axe:{run(options:unknown):Promise<{violations:unknown[]}>}}).axe;
    return (await axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations;
  });
  expect(violations).toEqual([]);
});
