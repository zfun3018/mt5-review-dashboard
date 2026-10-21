import { test, expect } from "./fixtures.mjs";

const campaign = {
  id: "C-ORDER-1",
  symbol: "XAUUSD",
  side: "long",
  opened_at_utc: "2026-10-16T01:42:00Z",
  net_pnl: 286.4,
  scale_in_count: 1,
  campaign_r: null,
  risk_status: "missing",
  trade_type: "scene_follow",
  strategy: "strategy_breakout",
  trade_type_tags: ["scene_follow"],
  strategy_tags: ["strategy_breakout"],
  mistake_tags: [],
  review_text: "",
  entry_volume: 1.2,
  position_summaries: [
    {
      id: "P-ORDER-1",
      source_trade: { id: "T-ORDER-1", screenshot_url: "/synthetic.png" },
    },
  ],
};

const detail = {
  ...campaign,
  positions: [
    {
      id: "P-ORDER-1",
      side: "long",
      initial_stop_price: null,
      weighted_entry_price: 2661.2,
      entry_deals: [
        { time_utc: "2026-10-16T01:42:00Z", time_msc: 1, price: 2661.2, volume: 0.6 },
        { time_utc: "2026-10-16T02:03:00Z", time_msc: 2, price: 2663.1, volume: 0.6 },
      ],
      exit_deals: [
        {
          time_utc: "2026-10-16T03:30:00Z",
          time_msc: 3,
          price: 2675.5,
          volume: 1.2,
          profit: 286.4,
          commission: 0,
          swap: 0,
          fee: 0,
        },
      ],
      reconstruction_status: "complete",
    },
  ],
};

const catalog = {
  custom_fields: [],
  classification_options: [
    { id: "scene_follow", dimension: "trade_type", label: "趋势跟随", color: "#55d69b", active: true },
    { id: "scene_reversal", dimension: "trade_type", label: "反转试单", color: "#64b5ff", active: true },
      { id: "scene_range", dimension: "trade_type", label: "区间震荡", color: "#f2bd68", active: true },
    { id: "strategy_breakout", dimension: "strategy", label: "突破回踩", color: "#55d69b", active: true },
  ],
};

function response(route, body) {
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("order review workspace", () => {
  test("keeps mock review fields after a page reload", async ({ page, syntheticServer }) => {
    await page.goto(`${syntheticServer.baseURL}/orders/mock-review.html`);

    await page.locator('[data-multi-trigger="scene"]').click();
    await page.locator('[data-multi-option="scene"][data-value="反转试单"]').click();
    await page.locator('[data-multi-trigger="strategy"]').click();
    await page.locator('[data-multi-option="strategy"][data-value="均线回踩"]').click();
    await page.locator("#reviewText").fill("刷新后仍然保留的模拟复盘");

    await page.reload();

    await expect(page.locator('[data-multi-select="scene"] .choice-value-pill')).toHaveText("反转试单");
    await expect(page.locator('[data-multi-select="strategy"] .choice-value-pill')).toHaveText("均线回踩");
    await expect(page.locator("#reviewText")).toHaveValue("刷新后仍然保留的模拟复盘");
  });

  test("keeps the merged order review usable in one desktop viewport and contained on mobile", async ({ page, syntheticServer }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile-390";
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
    const errors = [];
    const reviewBodies = [];
    const stopBodies = [];
    const screenshotBodies = [];
    let persistedCampaign = { ...campaign };
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/custom-fields") return response(route, catalog);
      if (url.pathname === "/api/classification-options") return response(route, { classification_options: catalog.classification_options });
      if (url.pathname === "/api/analysis-settings") return response(route, { scratch_threshold_r: 0.15 });
      if (url.pathname === "/api/campaigns" && request.method() === "GET") {
        return response(route, { campaigns: [{ ...persistedCampaign }], total: 1, page: 1, page_size: 20 });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1" && request.method() === "GET") {
        return response(route, { ...detail, ...persistedCampaign, positions: detail.positions });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1/review" && request.method() === "PATCH") {
        const body = request.postDataJSON();
        reviewBodies.push(body);
        persistedCampaign = {
          ...persistedCampaign,
          ...body,
          trade_type: body.trade_type_tags?.[0] || "unclassified",
          strategy: body.strategy_tags?.[0] || "strategy_unclassified",
        };
        return response(route, { ...detail, ...persistedCampaign, positions: detail.positions });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1/initial-stop" && request.method() === "PATCH") {
        stopBodies.push(request.postDataJSON());
        return response(route, { ...detail, initial_stop_price: 2656.1, risk_status: "complete", campaign_r: 2.14 });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1/screenshot" && request.method() === "POST") {
        screenshotBodies.push(request.postDataJSON());
        return response(route, { screenshot_url: "/pasted.png" });
      }
      return response(route, {});
    });

    await page.goto(`${syntheticServer.baseURL}/orders/`);
    await expect(page.locator("#orderHead")).toContainText("订单信息");
    await expect(page.locator("#orderHead")).toContainText("R 值");
    await expect(page.locator("#orderHead")).toContainText("净盈亏");
    await expect(page.locator("[data-day-toggle]")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".campaign-kind-mark")).toHaveText("组");
    await expect(page.locator(".campaign-risk-mark")).toHaveText("!");
    await expect(page.locator("#campaignInitialStop")).toBeVisible();
    await page.locator("#campaignInitialStop").fill("2656.1");
    await page.locator("#campaignInitialStop").press("Tab");
    await expect.poll(() => stopBodies.at(-1)?.initial_stop_price).toBe(2656.1);
    await expect(page.locator(".screenshot-overlay-controls")).toBeVisible();
    await expect(page.locator("#replaceScreenshot")).toHaveText("替换");
    await expect(page.locator("#deleteScreenshot")).toHaveText("删除");
    await expect(page.locator("#detailReview")).toBeVisible();
    await expect(page.locator(".execution-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".execution-type.close")).toHaveText("平仓");
    await expect(page.locator(".execution-side").last()).toHaveText("平多");
    await expect(page.locator(".campaign-list-pnl").first()).not.toContainText("$");

    const composition = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        const box = node?.getBoundingClientRect();
        return box ? {left: box.left, top: box.top, width: box.width, height: box.height, right: box.right, bottom: box.bottom} : null;
      };
      const listModules = [...document.querySelectorAll(".orders-index-column > *")].map((node) => {
        const box = node.getBoundingClientRect();
        return {className: node.className, top: box.top, bottom: box.bottom};
      });
      return {
        listModules,
        detailReview: rect(".detail-review-column"),
        orderInfo: rect(".order-info-strip"),
        review: rect(".review-editor-panel"),
        screenshot: rect(".screenshot-editor"),
        overflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(composition.listModules).toHaveLength(2);
    expect(composition.listModules[0].bottom).toBeLessThanOrEqual(composition.listModules[1].top);
    expect(composition.overflow).toBe(true);
    expect(composition.orderInfo.top).toBeLessThanOrEqual(composition.review.top);
    if (!isMobile) expect(composition.screenshot.width).toBeGreaterThan(composition.detailReview.width);

    const listLayout = await page.locator(".trades-panel .table-wrap").evaluate((node) => ({
      overflowY: getComputedStyle(node).overflowY,
      pnlFontSize: getComputedStyle(node.querySelector(".campaign-list-pnl")).fontSize,
      groupPnlFontSize: getComputedStyle(node.querySelector(".campaign-day-summary strong:last-child")).fontSize,
    }));
    expect(listLayout.overflowY).toBe("auto");
    expect(Number.parseFloat(listLayout.pnlFontSize)).toBeGreaterThan(11);
    expect(listLayout.groupPnlFontSize).toBe(listLayout.pnlFontSize);

    await page.locator('[data-tag-trigger="trade_type_tags"]').click();
    await page.locator('[data-campaign-choice-option="scene_reversal"]').click();
    await expect(page.locator(".choice-popover")).toBeHidden();
    await expect.poll(() => reviewBodies.at(-1)?.trade_type_tags).toEqual(["scene_reversal"]);
    await expect(page.locator('[data-tag-picker="trade_type_tags"] .choice-value-pill')).toHaveText("反转试单");
    await expect(page.locator('[data-tag-picker="trade_type_tags"] .field-label')).toContainText("单选");
    await page.locator(".order-detail-title").click();
    await expect(page.locator(".choice-popover")).toBeHidden();

    await page.evaluate(() => {
      const file = new File(["pasted"], "pasted.png", { type: "image/png" });
      const clipboard = new DataTransfer();
      clipboard.items.add(file);
      document.querySelector(".order-detail-title").dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        clipboardData: clipboard,
      }));
    });
    await expect.poll(() => screenshotBodies.length).toBe(1);

    await page.locator("#detailReview").fill("自动保存的组合复盘");
    await expect.poll(() => reviewBodies.at(-1)?.review_text).toBe("自动保存的组合复盘");
    await page.reload();
    await expect(page.locator('[data-tag-picker="trade_type_tags"] .choice-value-pill')).toHaveText("反转试单");
    await expect(page.locator("#detailReview")).toHaveValue("自动保存的组合复盘");
    await page.locator("#detailReview").fill("刷新前最后输入也要保留");
    await page.reload();
    await expect(page.locator("#detailReview")).toHaveValue("刷新前最后输入也要保留");

    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      height: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    const verticalLayout = await page.evaluate(() => {
      const screenshot = document.querySelector(".screenshot-editor")?.getBoundingClientRect();
      const execution = document.querySelector(".execution-section")?.getBoundingClientRect();
      return { screenshotBottom: screenshot?.bottom || 0, executionTop: execution?.top || 0 };
    });
    expect(verticalLayout.screenshotBottom).toBeLessThanOrEqual(verticalLayout.executionTop + 1);
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.height).toBeGreaterThanOrEqual(dimensions.viewportHeight);
    expect(errors).toEqual([]);
  });

  test("uses the shared compact list and shows the futures code in the detail title", async ({ page, syntheticServer }) => {
    const futuresCampaign = {
      ...campaign,
      platform: "domestic_futures",
      symbol: "V2701",
      display_symbol: "PVC2701",
      contract_name: "PVC2701",
      side: "short",
      net_pnl: -72.02,
    };
    const futuresDetail = { ...detail, ...futuresCampaign, positions: detail.positions };
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/custom-fields") return response(route, catalog);
      if (url.pathname === "/api/classification-options") return response(route, { classification_options: catalog.classification_options });
      if (url.pathname === "/api/analysis-settings") return response(route, { scratch_threshold_r: 0.15 });
      if (url.pathname === "/api/campaigns" && request.method() === "GET") {
        return response(route, { campaigns: [futuresCampaign], total: 1, page: 1, page_size: 20 });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1" && request.method() === "GET") {
        return response(route, futuresDetail);
      }
      return response(route, {});
    });

    await page.goto(`${syntheticServer.baseURL}/orders/?platform=domestic_futures`);
    await expect(page.locator("#orderHead")).toContainText("订单信息");
    await expect(page.locator(".campaign-list-contract")).toHaveText("PVC2701");
    await expect(page.locator(".campaign-list-pnl")).toHaveText("-72.02");
    await expect(page.locator(".detail-contract-name")).toHaveText("PVC2701");
    await expect(page.locator(".detail-contract-code")).toHaveText("V2701");
    expect(errors).toEqual([]);
  });
});
