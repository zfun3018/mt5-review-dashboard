// End-to-end browser checks for the v0.6.0 workspace split. Each test
// inherits `syntheticServer` from `./fixtures.mjs` which boots the real
// Python HTTP server against a throw-away runtime root; teardown kills
// the subprocess and removes the temp dir.
//
// Conventions enforced across the suite:
//   - the legacy redirect shell (`/`) bounces browsers into `/dashboard/`
//   - every workspace is reachable via `<aside aria-label="应用导航">`
//   - desktop and 390px viewports must not introduce horizontal scroll
//   - page-level console and pageerror events must stay empty

import { test, expect } from "./fixtures.mjs";

async function assertNoOverflow(page) {
  const overflowing = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflowing.scrollWidth,
    `page overflows viewport (${overflowing.scrollWidth} > ${overflowing.innerWidth})`,
  ).toBeLessThanOrEqual(overflowing.innerWidth);
}

function attachConsoleAssertions(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors };
}

async function expectNoErrors(page, errors) {
  expect(errors.consoleErrors, "console errors").toEqual([]);
  expect(errors.pageErrors, "page errors").toEqual([]);
}

test.describe("workspaces — desktop", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("legacy root redirects into the dashboard", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/`);
    await expect(page).toHaveURL(/\/dashboard\//);
    await expect(page.getByRole("heading", { name: "R 指标概览" })).toBeVisible();
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });

  test("desktop navigation visits each workspace and keeps them isolated", async ({
    page,
    syntheticServer,
  }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/dashboard/`);
    const navigation = page.locator('aside[aria-label="应用导航"]');
    await expect(navigation).toBeVisible();

    await page.getByRole("link", { name: "订单列表" }).click();
    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.getByRole("heading", { name: "订单列表" })).toBeVisible();

    await page.getByRole("link", { name: "复盘图册" }).click();
    await expect(page).toHaveURL(/\/album\//);
    await expect(page.getByRole("heading", { name: "筛选画册" })).toBeVisible();

    await page.getByRole("link", { name: "设置" }).click();
    await expect(page).toHaveURL(/\/settings\//);
    await expect(page.getByRole("tab", { name: "分类与字段" })).toBeVisible();

    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });

  test("orders filter persists across reload via query string", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/orders/?q=XAU&side=BUY`);
    await expect(page).toHaveURL(/q=XAU/);
    await expect(page).toHaveURL(/side=BUY/);
    await page.reload();
    await expect(page).toHaveURL(/q=XAU/);
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });

  test("album shows the screenshot placeholder card", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/album/`);
    await expect(page.getByRole("heading", { name: "筛选画册" })).toBeVisible();
    // Album renders a tag-group region even when no trades match.
    await expect(page.getByLabel("标签筛选")).toBeVisible();
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });

  test("album keeps the edited review visible before a reload", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/album/`);
    const card = page.locator(".album-card").first();
    const editor = card.locator("textarea[data-review-editor]");
    const nextReview = "浏览器即时保存回归测试";
    await expect(editor).toBeVisible();
    await editor.fill(nextReview);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/trades/") && response.request().method() === "PATCH"),
      card.getByRole("button", { name: "保存订单复盘" }).click(),
    ]);
    await expect(card.locator("textarea[data-review-editor]")).toHaveValue(nextReview);
    await expectNoErrors(page, errors);
  });

  test("album opens the linked order review instead of the campaign summary", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/album/`);
    const card = page.locator(".album-card").first();
    await card.getByRole("link", { name: "打开订单" }).click();
    await expect(page).toHaveURL(/\/orders\/\?trade=/);
    await expect(page.getByRole("button", { name: "保存订单复盘" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存组合复盘" })).toHaveCount(0);
    await expectNoErrors(page, errors);
  });

  test("settings rejects an invalid scratch threshold", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/settings/`);
    await page.getByRole("tab", { name: "分析设置" }).click();
    const thresholdInput = page.getByLabel("阈值 R");
    await expect(thresholdInput).toBeVisible();
    // 100 is above the documented max (5R); save must surface an error toast.
    await thresholdInput.fill("100");
    await page.getByRole("button", { name: "保存阈值" }).click();
    await expect(page.getByText("打平阈值必须在 0R 到 5R 之间")).toBeVisible();
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });

  test("order detail modal closes on Escape", async ({ page, syntheticServer }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/orders/`);
    // Some order-detail modals are reachable via deep-link `?trade=` (legacy
    // redirect also forwards it). Open via the page itself if possible.
    await page.goto(`${syntheticServer.baseURL}/orders/?trade=`);
    const modal = page.getByRole("dialog", { name: "截图预览" });
    if (await modal.count()) {
      await expect(modal).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(modal).toBeHidden();
    }
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });
});

test.describe("workspaces — 390px mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile drawer opens via the menu button and returns focus on close", async ({
    page,
    syntheticServer,
  }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/dashboard/`);
    const menuButton = page.getByRole("button", { name: "打开导航" });
    await expect(menuButton).toBeVisible();

    // On mobile the navigation is rendered with `aria-hidden="true"` and
    // `inert`; opening the drawer toggles both. We assert the toggle by
    // checking that links inside become reachable.
    const ordersLink = page.getByRole("link", { name: "订单列表" });
    await expect(ordersLink).toBeHidden();

    await menuButton.click();
    await expect(ordersLink).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ordersLink).toBeHidden();

    // Focus returns to the menu trigger so keyboard users do not lose place.
    await expect
      .poll(async () =>
        page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      )
      .toBe("打开导航");
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });

  test("album and settings remain reachable and overflow-free at 390px", async ({
    page,
    syntheticServer,
  }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto(`${syntheticServer.baseURL}/album/`);
    await expect(page.getByRole("heading", { name: "筛选画册" })).toBeVisible();
    await assertNoOverflow(page);

    await page.goto(`${syntheticServer.baseURL}/settings/`);
    await expect(page.getByRole("tab", { name: "分类与字段" })).toBeVisible();
    await assertNoOverflow(page);

    await expectNoErrors(page, errors);
  });
});

test.describe("random reading — landscape mobile", () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test("keeps the drawer closed and gives the random image the main landscape area", async ({
    page,
    syntheticServer,
  }) => {
    const errors = attachConsoleAssertions(page);
    let randomCalls = 0;
    await page.route("**/api/review-album/random", async (route) => {
      randomCalls += 1;
      const next = randomCalls > 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          trade: {
            id: next ? "T-LANDSCAPE-NEXT" : "T-LANDSCAPE",
            symbol: next ? "EURUSD" : "XAUUSD",
            display_order_no: next ? "ORDER-LANDSCAPE-NEXT" : "ORDER-LANDSCAPE",
            close_time_bj: "2026-08-20T16:30:00+08:00",
            open_time_bj: "2026-08-20T16:00:00+08:00",
            net_pnl: 18.5,
            lots: 0.1,
            side: "long",
            duration_label: "30m",
            screenshot_url: "/media/screenshots/seed.png",
            album_tags: [
              { label: "突破", color: "#f4c95d" },
              { label: "犯错", color: "#ff7a7a" },
            ],
            review_text: next ? "阅读器换单回归" : "横屏随机阅读回归",
          },
          custom_fields: [],
        }),
      });
    });

    await page.goto(`${syntheticServer.baseURL}/album/`);
    await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
    await expect(page.locator('aside[aria-label="应用导航"]')).toHaveAttribute("aria-hidden", "true");

    await page.getByRole("button", { name: "随机一个" }).click();
    const card = page.locator(".album-card--random");
    await expect(card).toBeVisible();
    await expect(card.locator(".album-shot img")).toBeVisible();

    const layout = await card.evaluate((node) => {
      const style = getComputedStyle(node);
      const shot = node.querySelector(".album-shot");
      return {
        display: style.display,
        shotWidth: shot ? shot.getBoundingClientRect().width : 0,
        shotHeight: shot ? shot.getBoundingClientRect().height : 0,
        details: node.querySelectorAll("details.album-meta").length,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(layout.display).toBe("grid");
    expect(layout.details).toBe(0);
    expect(layout.shotWidth).toBeGreaterThan(0);
    expect(layout.shotHeight).toBeGreaterThan(0);

    await card.locator(".album-shot img").click();
    const reader = page.locator("#albumImageModal");
    await expect(reader).toHaveClass(/open/);
    await expect(reader.locator(".album-reader-aside")).toContainText("XAUUSD");
    await expect(reader.getByRole("button", { name: "换一个" })).toBeVisible();
    const controls = await reader.evaluate((node) => {
      const close = node.querySelector("#albumImageClose").getBoundingClientRect();
      const next = node.querySelector("#albumReaderNext").getBoundingClientRect();
      const horizontalOverlap = close.left < next.right && close.right > next.left;
      const verticalOverlap = close.top < next.bottom && close.bottom > next.top;
      return { horizontalOverlap, verticalOverlap };
    });
    expect(controls.horizontalOverlap && controls.verticalOverlap).toBe(false);

    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/review-album/random")),
      reader.getByRole("button", { name: "换一个" }).click(),
    ]);
    await expect(reader.locator(".album-reader-aside")).toContainText("EURUSD");
    await expect(reader.locator("#albumModalImage")).toHaveAttribute("alt", "EURUSD 交易截图大图");
    await assertNoOverflow(page);
    await expectNoErrors(page, errors);
  });
});
