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
    let persistedCampaign = {
      ...campaign,
      mistake_tags: ["mistake_background", "mistake_averaging", "mistake_stop", "mistake_chase", "mistake_setup"],
    };
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/custom-fields") return response(route, {
        ...catalog,
        custom_fields: [{
          id: "mistake-tags",
          name: "犯错",
          field_type: "multi",
          options: [
            { id: "mistake_background", label: "忽略关键背景" },
            { id: "mistake_averaging", label: "逆势连续加仓" },
            { id: "mistake_stop", label: "未按计划止损" },
            { id: "mistake_chase", label: "错过后追单入场" },
            { id: "mistake_setup", label: "交易条件不充分" },
          ],
        }],
      });
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
    await expect(page.locator('[data-tag-trigger="trade_type_tags"]')).toBeVisible();
    await expect(page.locator('[data-tag-trigger="strategy_tags"]')).toBeVisible();
    await expect(page.locator(".order-info-strip")).toContainText("犯错标签");
    await expect(page.locator('.order-info-strip [data-tag-picker="mistake_tags"] .choice-value-pill')).toHaveCount(5);
    await expect(page.locator(".order-info-strip")).not.toContainText("初始止损");
    await expect(page.locator(".order-info-strip")).not.toContainText("交易场景");
    await expect(page.locator(".order-info-strip")).not.toContainText("交易策略");
    const tagFlow = await page.locator(".order-info-strip").evaluate((region) => {
      const regionBox = region.getBoundingClientRect();
      const tags = [...region.querySelectorAll(".choice-value-pill")].map((tag) => {
        const box = tag.getBoundingClientRect();
        return { top: box.top, left: box.left, right: box.right };
      });
      const header = document.querySelector(".detail-primary-review-fields").getBoundingClientRect();
      const featured = document.querySelector("#featureCampaign").getBoundingClientRect();
      const fields = document.querySelector(".detail-primary-review-fields");
      const featuredButton = document.querySelector("#featureCampaign");
      return {
        width: regionBox.width,
        maxWidth: region.parentElement.getBoundingClientRect().width,
        scrollWidth: region.scrollWidth,
        tagRows: new Set(tags.map((tag) => Math.round(tag.top))).size,
        tagsContained: tags.every((tag) => tag.left >= regionBox.left && tag.right <= regionBox.right + 1),
        reviewFieldsBeforeFeatured: Boolean(fields.compareDocumentPosition(featuredButton) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (window.innerWidth <= 560 || header.left < featured.left),
      };
    });
    expect(tagFlow.width).toBeLessThanOrEqual(tagFlow.maxWidth + 1);
    expect(tagFlow.scrollWidth).toBeLessThanOrEqual(tagFlow.width + 1);
    expect(tagFlow.tagsContained).toBe(true);
    expect(tagFlow.tagRows).toBeGreaterThan(1);
    expect(tagFlow.reviewFieldsBeforeFeatured).toBe(true);
    if (!isMobile) {
      const headerAlignment = await page.evaluate(() => {
        const bounds = [".order-detail-heading", ".detail-primary-review-fields", ".detail-order-actions"]
          .map((selector) => document.querySelector(selector).getBoundingClientRect());
        return {
          leftToRight: bounds[0].right <= bounds[1].left + 1 && bounds[1].right <= bounds[2].left + 1,
          centers: bounds.map((box) => box.top + box.height / 2),
        };
      });
      expect(headerAlignment.leftToRight).toBe(true);
      expect(Math.max(...headerAlignment.centers) - Math.min(...headerAlignment.centers)).toBeLessThanOrEqual(2);
    }
    await expect(page.locator("#checkinCampaign .detail-checkin-label")).toHaveText("今日打卡");
    const reviewControlStyles = await page.evaluate(() => {
      const style = (selector) => {
        const node = document.querySelector(selector);
        const computed = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {radius: computed.borderRadius, width: rect.width, height: rect.height, display: computed.display};
      };
      return {
        info: style(".order-info-strip"),
        field: style(".detail-primary-review-fields .order-info-field"),
        stop: style("#campaignInitialStop"),
        choice: style('[data-tag-trigger="trade_type_tags"]'),
        checkin: style("#checkinCampaign"),
        dailyPnl: style(".campaign-day-summary .campaign-day-pnl-pill"),
      };
    });
    expect(reviewControlStyles.info.radius).toBe("18px");
    expect(reviewControlStyles.field.radius).toBe("0px");
    expect(reviewControlStyles.stop.radius).toBe("999px");
    expect(reviewControlStyles.choice.radius).toBe("999px");
    expect(reviewControlStyles.checkin.radius).toBe("999px");
    expect(reviewControlStyles.checkin.width).toBeGreaterThan(120);
    expect(reviewControlStyles.dailyPnl.radius).toBe("999px");
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
        orderListPanel: rect(".trades-panel"),
        detailPanel: rect(".detail-panel"),
        detailReview: rect(".detail-review-column"),
        orderInfo: rect(".order-info-strip"),
        review: rect(".review-editor-panel"),
        screenshot: rect(".screenshot-editor"),
        overflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(composition.listModules).toHaveLength(2);
    expect(composition.listModules[0].bottom).toBeLessThanOrEqual(composition.listModules[1].top);
    if (!isMobile) {
      expect(Math.abs(composition.orderListPanel.height - composition.detailPanel.height)).toBeLessThanOrEqual(1);
    }
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

    if (!isMobile) {
      const stickyHeader = await page.locator(".trades-panel .table-wrap").evaluate((scroller) => {
        const body = scroller.querySelector("tbody");
        const source = body.querySelector("tr:not(.campaign-day-row)");
        for (let index = 0; index < 18; index += 1) body.append(source.cloneNode(true));
        scroller.scrollTop = 120;
        const header = scroller.querySelector("thead th");
        const headerBox = header.getBoundingClientRect();
        const scrollerBox = scroller.getBoundingClientRect();
        return {
          scrollTop: scroller.scrollTop,
          stickyTopOffset: headerBox.top - scrollerBox.top,
          background: getComputedStyle(header).backgroundColor,
          position: getComputedStyle(header).position,
        };
      });
      expect(stickyHeader.scrollTop).toBeGreaterThan(0);
      expect(Math.abs(stickyHeader.stickyTopOffset)).toBeLessThanOrEqual(1);
      expect(stickyHeader.position).toBe("sticky");
      expect(stickyHeader.background).toBe("rgb(21, 26, 34)");
    }

    await page.locator('[data-tag-trigger="trade_type_tags"]').click();
    await page.locator('[data-campaign-choice-option="scene_reversal"]').click();
    await expect(page.locator(".choice-popover")).toBeHidden();
    await expect.poll(() => reviewBodies.at(-1)?.trade_type_tags).toEqual(["scene_reversal"]);
    await expect(page.locator('[data-tag-picker="trade_type_tags"] .choice-value-pill')).toHaveText("反转试单");
    await expect(page.locator('[data-tag-picker="trade_type_tags"] .field-label')).toContainText("单选");
    await page.locator(".detail-body").click({ position: { x: 8, y: 8 } });
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

  test("keeps the selected detail and scroll position when adding an order to featured", async ({ page, syntheticServer }) => {
    let featured = false;
    let campaignListCalls = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/custom-fields") return response(route, catalog);
      if (url.pathname === "/api/classification-options") return response(route, { classification_options: catalog.classification_options });
      if (url.pathname === "/api/analysis-settings") return response(route, { scratch_threshold_r: 0.15 });
      if (url.pathname === "/api/campaigns" && request.method() === "GET") {
        campaignListCalls += 1;
        return response(route, { campaigns: [{ ...campaign, is_featured: featured }], total: 1, page: 1, page_size: 20 });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1" && request.method() === "GET") {
        return response(route, { ...detail, ...campaign, is_featured: featured, positions: detail.positions });
      }
      if (url.pathname === "/api/campaigns/C-ORDER-1/featured" && request.method() === "PATCH") {
        featured = Boolean(request.postDataJSON()?.featured);
        return response(route, { ...campaign, is_featured: featured });
      }
      if (url.pathname === "/api/campaign-checkins") return response(route, { days: [], today: { count: 0 }, daily_goal: 1 });
      return response(route, {});
    });

    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto(`${syntheticServer.baseURL}/orders/`);
    await expect(page.locator("#featureCampaign")).toBeVisible();
    await page.locator("#featureCampaign").scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await page.locator("#featureCampaign").click();
    await expect.poll(() => featured).toBe(true);
    await page.waitForTimeout(200);
    expect(campaignListCalls).toBe(1);
    await expect(page.locator("#featureCampaign")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#detailReview")).toBeVisible();
    await expect(page.locator("#orderDetail")).not.toContainText("正在加载主订单详情");
    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBe(before);
  });

  test("removes a cancelled featured order and selects the next detail without reloading the list", async ({ page, syntheticServer }) => {
    const first = { ...campaign, id: "C-FEATURED-1", display_symbol: "第一笔精选", is_featured: true };
    const second = { ...campaign, id: "C-FEATURED-2", display_symbol: "第二笔精选", is_featured: true };
    const details = {
      [first.id]: { ...detail, ...first, positions: detail.positions },
      [second.id]: { ...detail, ...second, positions: detail.positions },
    };
    const featuredIds = new Set([first.id, second.id]);
    let campaignListCalls = 0;
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/custom-fields") return response(route, catalog);
      if (url.pathname === "/api/classification-options") return response(route, { classification_options: catalog.classification_options });
      if (url.pathname === "/api/analysis-settings") return response(route, { scratch_threshold_r: 0.15 });
      if (url.pathname === "/api/campaigns" && request.method() === "GET") {
        campaignListCalls += 1;
        return response(route, {
          campaigns: [first, second].filter((item) => featuredIds.has(item.id)),
          total: featuredIds.size,
          page: 1,
          page_size: 20,
        });
      }
      if (url.pathname === "/api/campaigns/C-FEATURED-1/featured" && request.method() === "PATCH") {
        featuredIds.delete(first.id);
        return response(route, { ...first, is_featured: false });
      }
      if (url.pathname === "/api/campaigns/C-FEATURED-1" && request.method() === "GET") {
        return response(route, details[first.id]);
      }
      if (url.pathname === "/api/campaigns/C-FEATURED-2" && request.method() === "GET") {
        return response(route, details[second.id]);
      }
      if (url.pathname === "/api/campaign-checkins") return response(route, { days: [], today: { count: 0 }, daily_goal: 1 });
      return response(route, {});
    });

    await page.goto(`${syntheticServer.baseURL}/orders/?listView=featured`);
    await expect(page.locator('[data-campaign-id="C-FEATURED-1"]')).toHaveClass(/active/);
    await page.locator("#featureCampaign").click();

    await expect(page.locator('[data-campaign-id="C-FEATURED-1"]')).toHaveCount(0);
    await expect(page.locator('[data-campaign-id="C-FEATURED-2"]')).toHaveClass(/active/);
    await expect(page.locator(".detail-contract-name")).toContainText("第二笔精选");
    await expect(page.locator("#orderDetail")).not.toContainText("正在加载主订单详情");
    expect(campaignListCalls).toBe(1);
  });
});
