import {test, expect} from "./fixtures.mjs";

async function assertNoOverflow(page) {
  const state = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth);
}

async function assertNoErrors(page) {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("domestic futures account dashboard renders without horizontal overflow", async ({page, syntheticServer}) => {
  const errors = await assertNoErrors(page);
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await expect(page.getByRole("heading", {name: "固定周期指标"})).toBeVisible();
  await expect(page.getByText("最近 1 年", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "合约亏损榜"})).toBeVisible();
  await expect(page.locator("#domesticNetChart canvas")).toHaveCount(1);
  await expect(page.locator("#domesticMonthlyChart canvas")).toHaveCount(1);
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("domestic futures dashboard keeps the period cards usable on 390px", async ({page, syntheticServer}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await expect(page.getByRole("heading", {name: "固定周期指标"})).toBeVisible();
  await expect(page.locator(".domestic-period-grid")).toBeVisible();
  const chartSizes = await page.evaluate(() => ["domesticNetChart", "domesticMonthlyChart"].map((id) => {
    const rect = document.getElementById(id)?.getBoundingClientRect();
    return {width: rect?.width || 0, height: rect?.height || 0};
  }));
  expect(chartSizes.every(({width, height}) => width > 0 && height > 0)).toBe(true);
  await assertNoOverflow(page);
});

test("domestic dashboard uses the preview range control and explains empty risk data", async ({page, syntheticServer}) => {
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  const presets = page.locator("[data-domestic-preset]");
  await expect(presets).toHaveCount(5);
  await expect(page.locator('[data-domestic-preset="all"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-domestic-custom-dates]')).toBeHidden();
  await expect(page.getByText("当前范围暂无已实现交易，无法评估风险压力")).toBeVisible();

  await page.locator('[data-domestic-preset="7d"]').click();
  await expect(page).toHaveURL(/preset=7d/);
  await expect(page.locator('[data-domestic-preset="7d"]')).toHaveClass(/is-active/);

  await page.locator('[data-domestic-preset="custom"]').click();
  await expect(page.locator('[data-domestic-custom-dates]')).toBeVisible();
});

test("domestic dashboard opens the standalone layout editor with a return route", async ({page, syntheticServer}) => {
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await page.getByRole("link", {name: "打开仪表盘布局编辑器"}).click();
  await expect(page).toHaveURL(/mock-domestic-futures-layout\.html\?return=/);
  await expect(page.locator("#editorGrid .grid-stack-item")).toHaveCount(14);
});
