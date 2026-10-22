import {test, expect} from "./fixtures.mjs";

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("B0 lab supports modular dashboard editing and persistence", async ({page, syntheticServer}) => {
  const errors = captureErrors(page);
  await page.goto(`${syntheticServer.baseURL}/b0-lab/`);
  await expect(page.locator("[data-b0-app]")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".module-card")).toHaveCount(4);
  await expect(page.locator("canvas")).toHaveCount(3);
  await expect(page.locator("#emptyWorkspace")).toBeHidden();

  await page.getByRole("button", {name: "编辑布局"}).click();
  await expect(page.locator("[data-b0-app]")).toHaveAttribute("data-mode", "edit");
  await page.getByRole("button", {name: "打开模块库"}).click();
  await page.locator('[data-add-type="monthly-pnl"]').click();
  await expect(page.locator(".module-card")).toHaveCount(5);

  const firstCard = page.locator(".module-card").first();
  await firstCard.getByRole("button", {name: "复制模块"}).click();
  await expect(page.locator(".module-card")).toHaveCount(6);
  await page.locator(".module-card").last().getByRole("button", {name: "删除模块"}).click();
  await expect(page.locator(".module-card")).toHaveCount(5);

  await page.reload();
  await expect(page.locator("[data-b0-app]")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".module-card")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("B0 lab resizes modules in edit mode and persists their dimensions", async ({page, syntheticServer}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "freeform resize is a desktop interaction");
  const errors = captureErrors(page);
  await page.goto(`${syntheticServer.baseURL}/b0-lab/`);
  await page.getByRole("button", {name: "编辑布局"}).click();

  const module = page.locator('[data-instance-id="equity-main"]');
  await expect(page.locator("[data-edit-status]")).toBeVisible();
  await expect(module.locator("[data-module-size]")).toHaveText("8 × 5");

  const resizeHandle = module.locator(".ui-resizable-se");
  await expect(resizeHandle).toBeVisible();
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(handleBox.width).toBeGreaterThanOrEqual(20);
  expect(handleBox.height).toBeGreaterThanOrEqual(20);

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 - 170, handleBox.y + handleBox.height / 2 + 70, {steps: 12});
  await page.mouse.up();

  await expect(module).not.toHaveAttribute("gs-w", "8");
  await expect(module).not.toHaveAttribute("gs-h", "5");
  const resized = await module.evaluate((element) => ({
    w: element.getAttribute("gs-w"),
    h: element.getAttribute("gs-h"),
  }));
  await expect(module.locator("[data-module-size]")).toHaveText(`${resized.w} × ${resized.h}`);

  await page.getByRole("button", {name: "完成编辑"}).click();
  await page.reload();
  await expect(page.locator('[data-instance-id="equity-main"]')).toHaveAttribute("gs-w", resized.w);
  await expect(page.locator('[data-instance-id="equity-main"]')).toHaveAttribute("gs-h", resized.h);
  expect(errors).toEqual([]);
});

test("B0 lab fits the viewport without horizontal overflow", async ({page, syntheticServer}) => {
  const errors = captureErrors(page);
  await page.goto(`${syntheticServer.baseURL}/b0-lab/`);
  await expect(page.locator("[data-b0-app]")).toHaveAttribute("data-ready", "true");
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(errors).toEqual([]);
});
