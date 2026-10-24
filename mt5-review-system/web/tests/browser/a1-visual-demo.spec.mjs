import {test, expect} from "./fixtures.mjs";

test("isolated A1 visual demo demonstrates the glass component contract", async ({page, syntheticServer}) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto(`${syntheticServer.baseURL}/a1-visual-demo/`);
  await expect(page.locator(".topbar-title strong")).toHaveText("玻璃风格试验台");
  await expect(page.locator(".sidebar-bottom small")).toHaveText("仅用于视觉演示");
  if (page.viewportSize().width > 760) await expect(page.locator(".sidebar-bottom small")).toBeVisible();
  await expect(page.getByRole("heading", {name: "材质与形状约束"})).toBeVisible();

  const styles = await page.evaluate(() => {
    const windowStyle = getComputedStyle(document.querySelector(".demo-window"));
    const panel = getComputedStyle(document.querySelector(".metric-panel"));
    const pill = getComputedStyle(document.querySelector(".pill-button"));
    const circles = [...document.querySelectorAll(".circle-button")].map((button) => {
      const style = getComputedStyle(button);
      return {width: style.width, height: style.height, radius: style.borderRadius};
    });
    const root = getComputedStyle(document.documentElement);
    return {
      viewportWidth: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      windowRadius: windowStyle.borderRadius,
      windowShadow: windowStyle.boxShadow,
      panelRadius: panel.borderRadius,
      panelShadow: panel.boxShadow,
      panelBlur: panel.backdropFilter,
      pillRadius: pill.borderRadius,
      circles,
      pillHeights: [...document.querySelectorAll(".pill-button")].map((button) => getComputedStyle(button).height),
      glassFill: root.getPropertyValue("--glass-fill").trim(),
    };
  });

  expect(styles.overflow).toBe(false);
  expect(styles.windowRadius).toBe(styles.viewportWidth <= 760 ? "0px" : "28px");
  expect(styles.panelRadius).toBe("24px");
  expect(styles.panelShadow).toContain("32px 84px");
  expect(styles.panelBlur).toContain("blur(32px)");
  expect(styles.pillRadius).toBe("999px");
  expect(new Set(styles.circles.map(({width, height, radius}) => `${width}/${height}/${radius}`)).size).toBe(1);
  expect(styles.circles[0]).toEqual({width: "42px", height: "42px", radius: "50%"});
  expect(new Set(styles.pillHeights)).toEqual(new Set(["42px"]));
  expect(styles.glassFill).toBe("rgba(18, 22, 29, 0.58)");

  await page.getByRole("button", {name: "组件预览"}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", {name: "确认样式"}).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const selectedRange = page.locator(".segmented button.selected");
  await page.getByRole("button", {name: "今天"}).click();
  await expect(selectedRange).toHaveText("今天");
  expect(browserErrors).toEqual([]);
});
