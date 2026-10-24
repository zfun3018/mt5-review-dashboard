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
  await page.route("**/api/analysis**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.contract_rankings = {
      contribution: [
        {contract_name: "豆粕2701", product_name: "豆粕", order_count: 2, net_pnl: 173.96},
        {contract_name: "PVC2701", product_name: "PVC", order_count: 7, net_pnl: -344.14},
        {contract_name: "玉米2611", product_name: "玉米", order_count: 1, net_pnl: 0},
      ],
      losses: [
        {contract_name: "PVC2701", product_name: "PVC", order_count: 7, net_pnl: -344.14},
        {contract_name: "乙烯2611", product_name: "苯乙烯", order_count: 2, net_pnl: -149.04},
        {contract_name: "玻璃2701", product_name: "玻璃", order_count: 2, net_pnl: -28.04},
      ],
    };
    payload.metric_meta = {...payload.metric_meta, contract_rankings: {status: "available"}};
    await route.fulfill({response, json: payload});
  });
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await expect(page.getByRole("heading", {name: "固定周期指标"})).toBeVisible();
  await expect(page.getByText("最近 1 年", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "合约亏损榜"})).toBeVisible();
  await expect(page.locator("#domesticNetChart canvas")).toHaveCount(1);
  await expect(page.locator("#domesticMonthlyChart canvas")).toHaveCount(1);
  await expect(page.locator("#domesticCalendarChart canvas")).toHaveCount(1);
  await expect(page.locator("#domesticRiskGauge canvas")).toHaveCount(1);
  await expect(page.locator("#domesticContractContribution canvas")).toHaveCount(1);
  await expect(page.locator("#domesticContractLosses canvas")).toHaveCount(1);
  const calendarLayout = await page.locator("#domesticCalendarChart").evaluate((node) => {
    const chart = globalThis.echarts?.getInstanceByDom(node);
    const option = chart?.getOption();
    const calendar = option?.calendar?.[0] || option?.calendar;
    const bounds = node.getBoundingClientRect();
    return {
      orient: calendar?.orient,
      weekdayFontSize: calendar?.dayLabel?.fontSize,
      calendarWidth: bounds.width,
      calendarHeight: bounds.height,
    };
  });
  expect(calendarLayout.orient).toBe("vertical");
  expect(calendarLayout.weekdayFontSize).toBe(12);
  expect(calendarLayout.calendarWidth).toBeGreaterThan(0);
  expect(calendarLayout.calendarHeight).toBeGreaterThan(0);
  const contributionChart = await page.locator("#domesticContractContribution").evaluate((node) => {
    const chart = globalThis.echarts?.getInstanceByDom(node);
    const option = chart?.getOption();
    const series = option?.series?.[0];
    return {
      type: series?.type,
      roseType: series?.roseType,
      data: series?.data || [],
      firstLabel: series?.label?.formatter?.({data: series?.data?.[0]}),
      width: node.clientWidth,
      height: node.clientHeight,
    };
  });
  expect(contributionChart.type).toBe("pie");
  expect(contributionChart.roseType).toBe("radius");
  expect(contributionChart.data.map((item) => item.name)).toEqual(["豆粕2701"]);
  expect(contributionChart.data.every((item) => item.netPnl > 0)).toBe(true);
  expect(contributionChart.firstLabel).toBe("豆粕2701\n+¥173.96");
  expect(contributionChart.width).toBeGreaterThan(0);
  expect(contributionChart.height).toBeGreaterThan(0);
  const lossChart = await page.locator("#domesticContractLosses").evaluate((node) => {
    const chart = globalThis.echarts?.getInstanceByDom(node);
    const series = chart?.getOption()?.series?.[0];
    return {type: series?.type, dataCount: series?.data?.length || 0, productColorCount: new Set((series?.data || []).map((item) => item.itemStyle?.color)).size};
  });
  expect(lossChart.type).toBe("treemap");
  expect(lossChart.dataCount).toBeGreaterThan(0);
  expect(lossChart.productColorCount).toBeGreaterThan(1);
  const glass = await page.locator(".domestic-module-panel").first().evaluate((module) => {
    const style = getComputedStyle(module);
    const tokens = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    probe.style.boxShadow = "var(--shadow-panel)";
    document.body.append(probe);
    const tokenShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    return {
      radius: style.borderRadius,
      panelRadius: tokens.getPropertyValue("--radius-panel").trim(),
      shadow: style.boxShadow,
      panelShadow: tokenShadow,
      blur: style.backdropFilter,
    };
  });
  expect(glass.radius).toBe(glass.panelRadius);
  expect(glass.shadow).toBe(glass.panelShadow);
  expect(glass.blur).toContain("blur(32px)");
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("dashboard page keeps scrolling when the pointer is over a chart module", async ({page, syntheticServer}) => {
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  const chart = page.locator("#domesticContractContribution");
  await chart.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.scrollingElement?.scrollTop || 0);
  const bounds = await chart.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 420);
  await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop || 0)).toBeGreaterThan(before);
});

test("page scroll chains through a module after its own content reaches the edge", async ({page, syntheticServer}) => {
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  const module = page.locator('.domestic-module[data-content-fit="scroll"]').filter({has: page.locator(".domestic-risk-score")});
  await module.scrollIntoViewIfNeeded();
  const state = await module.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    moduleScrollTop: node.scrollTop,
  }));
  expect(state.scrollHeight).toBeLessThanOrEqual(state.clientHeight);
  const before = await page.evaluate(() => document.scrollingElement?.scrollTop || 0);
  const bounds = await module.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 420);
  await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop || 0)).toBeGreaterThan(before);
});

test("page keeps scrolling when an overflowing module is already at its scroll edge", async ({page, syntheticServer}) => {
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  const module = page.locator('.domestic-module[data-content-fit="scroll"]').filter({has: page.locator(".domestic-risk-score")});
  const nestedScroll = await module.evaluate((node) => {
    const content = document.createElement("div");
    content.style.height = "1200px";
    content.style.minHeight = "1200px";
    content.style.flex = "0 0 1200px";
    content.textContent = "scroll boundary probe";
    node.append(content);
    node.scrollTop = 0;
    document.scrollingElement.scrollTop = 600;
    return {
      overscrollBehavior: getComputedStyle(node).overscrollBehavior,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      scrollTop: node.scrollTop,
    };
  });
  expect(nestedScroll.overscrollBehavior).toBe("auto");
  expect(nestedScroll.scrollHeight).toBeGreaterThan(nestedScroll.clientHeight);
  expect(nestedScroll.scrollTop).toBe(0);
  const before = await page.evaluate(() => document.scrollingElement?.scrollTop || 0);
  const bounds = await module.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop || 0)).toBeLessThan(before);
});

test("monthly futures chart renders separate profit and loss stacks with a monthly net line", async ({page, syntheticServer}) => {
  await page.route("**/api/analysis**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.monthly_pnl = [
      {month: "2026-08", net_pnl: 1900, product_pnl: [
        {product_name: "玻璃", net_pnl: 2000},
        {product_name: "螺纹钢", net_pnl: -100},
      ]},
      {month: "2026-09", net_pnl: -1800, product_pnl: [
        {product_name: "玻璃", net_pnl: -2000},
        {product_name: "螺纹钢", net_pnl: 200},
      ]},
    ];
    await route.fulfill({response, json: payload});
  });

  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await expect(page.locator("#domesticMonthlyChart canvas")).toHaveCount(1);
  await expect.poll(async () => page.locator("#domesticMonthlyChart").evaluate((node) => {
    const chart = globalThis.echarts?.getInstanceByDom(node);
    const option = chart?.getOption();
    return {
      profitStacks: option?.series?.filter((series) => series.stack === "monthly-profit").length || 0,
      lossStacks: option?.series?.filter((series) => series.stack === "monthly-loss").length || 0,
      netLines: option?.series?.filter((series) => series.type === "line" && series.name === "月度净盈亏").length || 0,
      netValues: option?.series?.find((series) => series.type === "line" && series.name === "月度净盈亏")?.data || [],
      productLabels: option?.series?.filter((series) => series.type === "bar").every((series) => series.label?.show && series.label?.formatter === series.name) || false,
      profitTotals: option?.series?.find((series) => series.name === "盈利汇总金额")?.data.map((item) => item.label.formatter) || [],
      lossTotals: option?.series?.find((series) => series.name === "亏损汇总金额")?.data.map((item) => item.label.formatter) || [],
      tooltipTrigger: option?.tooltip?.[0]?.trigger || option?.tooltip?.trigger,
    };
  })).toEqual({
    profitStacks: 2,
    lossStacks: 2,
    netLines: 1,
    netValues: [1900, -1800],
    productLabels: true,
    profitTotals: ["+¥2,000", "+¥200"],
    lossTotals: ["−¥100", "−¥2,000"],
    tooltipTrigger: "item",
  });
});

test("domestic futures dashboard keeps the period cards usable on 390px", async ({page, syntheticServer}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await expect(page.getByRole("heading", {name: "固定周期指标"})).toBeVisible();
  await expect(page.locator(".domestic-period-grid")).toBeVisible();
  const chartSizes = await page.evaluate(() => ["domesticNetChart", "domesticMonthlyChart", "domesticRiskGauge", "domesticContractContribution", "domesticContractLosses"].map((id) => {
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

test("domestic dashboard edits the same live GridStack modules and ECharts containers", async ({page, syntheticServer}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout editing contract");
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=domestic_futures`);
  await page.getByRole("link", {name: "打开仪表盘布局编辑器"}).click();
  await expect(page).toHaveURL(/\/dashboard\/index\.html\?platform=domestic_futures&layout=edit/);
  await expect(page.locator("#domesticLayoutEditor")).toBeVisible();
  await expect(page.locator(".editor-card")).toHaveCount(0);
  await expect(page.locator(".domestic-dashboard-stage > .grid-stack-item")).toHaveCount(11);
  for (const id of ["domesticNetChart", "domesticMonthlyChart", "domesticCalendarChart", "domesticRiskGauge", "domesticContractContribution", "domesticContractLosses"]) {
    await expect(page.locator(`#${id} canvas`)).toHaveCount(1);
  }

  const minCalendarHeight = await page.evaluate(() => {
    const root = document.querySelector(".domestic-dashboard-stage");
    const calendar = root.querySelector('[gs-id="daily-calendar"]');
    root.gridstack.update(calendar, {h: 1});
    return calendar.gridstackNode.h;
  });
  expect(minCalendarHeight).toBe(5);

  await page.evaluate(() => {
    const root = document.querySelector(".domestic-dashboard-stage");
    for (const item of root.querySelectorAll(":scope > .grid-stack-item")) {
      const minimum = item.gridstackNode;
      root.gridstack.update(item, {
        w: minimum.minW,
        h: minimum.minH,
      });
    }
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await page.locator("#domesticLayoutEditor [data-layout-save]").click();
  await expect(page).toHaveURL(/\/dashboard\/index\.html\?platform=domestic_futures$/);
  const savedLayout = await page.evaluate(() => JSON.parse(localStorage.getItem("domestic-futures-dashboard-layout-v3")));
  expect(savedLayout.items.find((item) => item.id === "daily-calendar").h).toBe(5);
  await expect(page.locator(".domestic-dashboard-stage > .grid-stack-item")).toHaveCount(11);
  for (const id of ["domesticNetChart", "domesticMonthlyChart", "domesticCalendarChart", "domesticRiskGauge", "domesticContractContribution", "domesticContractLosses"]) {
    await expect(page.locator(`#${id} canvas`)).toHaveCount(1);
  }
  const persistedGeometryMatches = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("domestic-futures-dashboard-layout-v3"));
    return saved.items.every((item) => {
      const element = document.querySelector(`.domestic-dashboard-stage [gs-id="${item.id}"]`);
      const node = element?.gridstackNode;
      return Boolean(node) && node.x === item.x && node.y === item.y && node.w === item.w && node.h === item.h;
    });
  });
  expect(persistedGeometryMatches).toBe(true);
  const moduleFitRulesApply = await page.locator(".domestic-dashboard-stage > .grid-stack-item").evaluateAll((items) => items.every((item) => {
    const module = item.querySelector(":scope > .grid-stack-item-content > .domestic-module");
    if (!module) return false;
    const fit = item.dataset.layoutFit;
    const overflow = getComputedStyle(module).overflowY;
    return (fit === "resize" && overflow === "hidden")
      || ((fit === "scroll" || fit === "flow") && ["auto", "scroll"].includes(overflow));
  }));
  expect(moduleFitRulesApply).toBe(true);
  const minimumContentIssues = await page.evaluate(() => [...document.querySelectorAll(".domestic-dashboard-stage > .grid-stack-item")].flatMap((item) => {
    const module = item.querySelector(":scope > .grid-stack-item-content > .domestic-module");
    const fit = item.dataset.layoutFit;
    if (!module) return [{id: item.getAttribute("gs-id"), issue: "missing module"}];
    if (item.gridstackNode.w !== item.gridstackNode.minW || item.gridstackNode.h !== item.gridstackNode.minH) {
      return [{
        id: item.getAttribute("gs-id"),
        issue: "minimum size not applied",
        w: item.gridstackNode.w,
        h: item.gridstackNode.h,
        minW: item.gridstackNode.minW,
        minH: item.gridstackNode.minH,
      }];
    }
    if (fit === "scroll" || fit === "flow") {
      return ["auto", "scroll"].includes(getComputedStyle(module).overflowY)
        ? []
        : [{id: item.getAttribute("gs-id"), issue: "scroll policy missing", overflowY: getComputedStyle(module).overflowY}];
    }
    const moduleRect = module.getBoundingClientRect();
    const clipped = [...module.children].flatMap((child) => {
      const rect = child.getBoundingClientRect();
      return rect.left >= moduleRect.left - 1 && rect.right <= moduleRect.right + 1
        && rect.top >= moduleRect.top - 1 && rect.bottom <= moduleRect.bottom + 1 ? [] : [{
          id: item.getAttribute("gs-id"),
          issue: "child exceeds module bounds",
          child: child.className,
          bottomOverflow: Math.round(rect.bottom - moduleRect.bottom),
          rightOverflow: Math.round(rect.right - moduleRect.right),
        }];
    });
    return clipped;
  }));
  expect(minimumContentIssues).toEqual([]);
  const chartContainmentIssues = await page.evaluate(() => ["domesticNetChart", "domesticMonthlyChart", "domesticCalendarChart", "domesticRiskGauge", "domesticContractContribution", "domesticContractLosses"].flatMap((id) => {
    const host = document.getElementById(id);
    const canvas = host?.querySelector("canvas");
    const parent = host?.closest(".domestic-module");
    if (!host || !canvas || !parent) return [{id, issue: "missing chart nodes"}];
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return hostRect.width > 0 && hostRect.height > 0 && canvasRect.width > 0 && canvasRect.height > 0
      && canvasRect.left >= parentRect.left - 1 && canvasRect.right <= parentRect.right + 1
      && canvasRect.top >= parentRect.top - 1 && canvasRect.bottom <= parentRect.bottom + 1 ? [] : [{
        id,
        host: {left: hostRect.left, top: hostRect.top, right: hostRect.right, bottom: hostRect.bottom, width: hostRect.width, height: hostRect.height},
        canvas: {left: canvasRect.left, top: canvasRect.top, right: canvasRect.right, bottom: canvasRect.bottom, width: canvasRect.width, height: canvasRect.height},
        parent: {left: parentRect.left, top: parentRect.top, right: parentRect.right, bottom: parentRect.bottom, width: parentRect.width, height: parentRect.height},
      }];
  }));
  expect(chartContainmentIssues).toEqual([]);
});
