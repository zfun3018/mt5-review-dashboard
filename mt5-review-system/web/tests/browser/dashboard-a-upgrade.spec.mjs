import {test, expect} from "./fixtures.mjs";

test("MT5 dashboard keeps every existing module, chart, and non-overlapping desktop layout", async ({page, syntheticServer}, testInfo) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=mt5`);
  await expect(page.locator("#mt5DashboardLayout > .grid-stack-item")).toHaveCount(9);
  await expect(page.locator("#equityChart canvas")).toHaveCount(1);
  await expect(page.locator("#systemEvaluationChart canvas")).toHaveCount(1);
  await expect(page.locator("#monthlyPnlChart canvas")).toHaveCount(1);
  await expect(page.locator("#heatmapChart canvas")).toHaveCount(1);
  const moduleFitRulesApply = await page.locator("#mt5DashboardLayout > .grid-stack-item").evaluateAll((items) => items.every((item) => {
    const module = item.querySelector(":scope > .grid-stack-item-content > .panel");
    if (!module) return false;
    const fit = item.dataset.layoutFit;
    const overflow = getComputedStyle(module).overflowY;
    return (fit === "resize" && overflow === "hidden")
      || ((fit === "scroll" || fit === "flow") && ["auto", "scroll"].includes(overflow));
  }));
  expect(moduleFitRulesApply).toBe(true);
  const chartCanvasBounds = await page.evaluate(() => ["equityChart", "systemEvaluationChart", "calendarChart", "monthlyPnlChart", "heatmapChart"].map((id) => {
    const host = document.getElementById(id);
    const canvas = host?.querySelector("canvas");
    const parent = host?.closest(".panel");
    if (!host || !canvas || !parent) return {id, fits: false};
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return {
      id,
      fits: hostRect.width > 0 && hostRect.height > 0 && canvasRect.width > 0 && canvasRect.height > 0
        && canvasRect.left >= parentRect.left - 1 && canvasRect.right <= parentRect.right + 1
        && canvasRect.top >= parentRect.top - 1 && canvasRect.bottom <= parentRect.bottom + 1,
      host: {x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height},
      canvas: {x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height},
      panel: {x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height},
    };
  }));
  expect(chartCanvasBounds.filter((bounds) => !bounds.fits)).toEqual([]);

  if (testInfo.project.name === "desktop-chromium") {
    const overlap = await page.locator("#mt5DashboardLayout > .grid-stack-item:not([hidden])").evaluateAll((items) => {
      const bounds = items.map((item) => item.getBoundingClientRect());
      return bounds.some((left, index) => bounds.slice(index + 1).some((right) => (
        left.left < right.right - 1
        && left.right > right.left + 1
        && left.top < right.bottom - 1
        && left.bottom > right.top + 1
      )));
    });
    expect(overlap).toBe(false);
  }

  expect(errors).toEqual([]);
});

test("MT5 dashboard aligns full-width modules and keeps its glass controls and calendar coherent", async ({page, syntheticServer}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop visual contract");
  await page.setViewportSize({width: 1094, height: 974});
  await page.addInitScript(() => localStorage.setItem("mt5-review-navigation-collapsed", "true"));
  await page.route("**/api/analysis**", (route) => route.fulfill({json: {
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    metrics: {order_count: 2, net_pnl: 5.5, payoff_ratio: 1.2, win_rate: 0.5},
    r_metrics: {sample_count: 2, complete_count: 2, sqn_status: "available", sqn: 1.2, decisive_win_rate: 0.5, expectancy_r: 0.4, z_score: 0.2},
    periods: {
      yesterday: {net_pnl: -40, order_count: 3, payoff_ratio: 0.8, r_metrics: {complete_count: 3, decisive_win_rate: 1 / 3, expectancy_r: -0.2, sqn_status: "insufficient_sample"}},
      last_7_days: {net_pnl: 120, order_count: 8, payoff_ratio: 1.8, r_metrics: {complete_count: 8, decisive_win_rate: 0.625, expectancy_r: 0.4, sqn_status: "insufficient_sample"}},
      last_30_days: {net_pnl: 80, order_count: 20, payoff_ratio: 1.2, r_metrics: {complete_count: 20, decisive_win_rate: 0.55, expectancy_r: 0.15, sqn_status: "insufficient_sample"}},
      last_365_days: {net_pnl: -250, order_count: 140, payoff_ratio: 0.9, r_metrics: {complete_count: 140, decisive_win_rate: 0.48, expectancy_r: -0.05, sqn: 1.12, sqn_status: "available"}},
    },
    equity: [],
    calendar: {
      year: 2026, month: 10, month_net_pnl: 5.5, month_order_count: 2, month_win_rate: 0.5,
      days: Object.fromEntries(Array.from({length: 31}, (_, index) => {
        const day = String(index + 1).padStart(2, "0");
        return [`2026-10-${day}`, {label: `2026-10-${day}`, net_pnl: index % 2 ? -6.4 : 5.5, order_count: 1, win_rate: 0.75}];
      })),
    },
    heatmap: {days: [], max_abs_pnl: 0},
    sessions: {asia: {name: "亚盘", city: "Tokyo", zone: "Asia/Tokyo", window: "08:00-15:00 BJT", win_rate: 0.5, note: "测试时段", volatile: "10:00-11:30"}},
    system_evaluation: [],
    mode_evaluation: {trade_type: [], strategy: []},
  }}));
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=mt5`);
  await expect(page.locator("#calendarChart canvas")).toHaveCount(1);
  await expect(page.locator("#systemEvaluationChart canvas")).toHaveCount(1);
  await expect(page.locator('[data-layout-module="period-overview"] h2')).toHaveText("交易系统评估");

  const visual = await page.evaluate(() => {
    const rect = (element) => {
      const {x, y, width, height} = element.getBoundingClientRect();
      return {x, y, right: x + width, width, height};
    };
    const metric = document.querySelector('[data-layout-module="r-metrics"]');
    const metricItem = metric.closest(".grid-stack-item");
    const metricPanelNode = metric.querySelector(".panel");
    const metricPanel = getComputedStyle(metricPanelNode);
    const activeMarket = getComputedStyle(document.querySelector(".market-card.active"));
    const activeNav = document.querySelector('.app-navigation__link[aria-current="page"]');
    const navIcon = activeNav.querySelector("svg");
    const calendarPanel = document.querySelector('[data-layout-module="calendar"] .panel');
    const calendarChart = document.querySelector("#calendarChart");
    const calendarInstance = globalThis.echarts.getInstanceByDom(calendarChart);
    const calendarOption = calendarInstance.getOption();
    const collapseButton = document.querySelector(".app-navigation__collapse");
    return {
      market: rect(document.querySelector("#marketClock")),
      metric: rect(metricPanelNode),
      metricWrapper: rect(metricItem),
      metricOverflow: metricPanel.overflow,
      metricScrollHeight: metric.scrollHeight,
      metricClientHeight: metric.clientHeight,
      activeMarketRadius: activeMarket.borderRadius,
      activeMarketBorder: activeMarket.borderColor,
      activeMarketShadow: activeMarket.boxShadow,
      calendarCanvas: rect(calendarChart.querySelector("canvas")),
      calendarChart: rect(calendarChart),
      calendarDayCount: calendarOption.series[0].data.length,
      calendarOrientation: calendarOption.calendar[0].orient,
      navLink: rect(activeNav),
      navLinkRadius: getComputedStyle(activeNav).borderRadius,
      navIconBackground: getComputedStyle(navIcon).backgroundColor,
      calendarPanel: rect(calendarPanel),
      collapseButton: rect(collapseButton),
      collapseRadius: getComputedStyle(collapseButton).borderRadius,
    };
  });

  expect(Math.abs(visual.metric.x - visual.market.x)).toBeLessThan(1);
  expect(Math.abs(visual.metric.right - visual.market.right)).toBeLessThan(1);
  expect(visual.metricOverflow).toBe("auto");
  expect(visual.metricScrollHeight).toBeLessThanOrEqual(visual.metricClientHeight);
  expect(visual.activeMarketBorder).not.toBe("rgb(55, 65, 81)");
  expect(visual.activeMarketShadow).not.toBe("none");
  expect(visual.calendarCanvas.width).toBeGreaterThan(0);
  expect(visual.calendarCanvas.height).toBeGreaterThan(0);
  expect(visual.calendarDayCount).toBe(31);
  expect(visual.calendarOrientation).toBe("vertical");
  expect(visual.navLink.width).toBe(48);
  expect(visual.navLink.height).toBe(48);
  expect(visual.navLinkRadius).toBe("15px");
  expect(visual.navIconBackground).toBe("rgba(0, 0, 0, 0)");
  expect(visual.calendarChart.y + visual.calendarChart.height).toBeLessThanOrEqual(visual.calendarPanel.y + visual.calendarPanel.height);
  expect(visual.collapseButton.width).toBe(42);
  expect(visual.collapseButton.height).toBe(42);
  expect(visual.collapseRadius).toBe("15px");
});

test("MT5 calendar labels break onto lines and evaluation headers stay legible while scrolling", async ({page, syntheticServer}, testInfo) => {
  await page.route("**/api/analysis**", (route) => route.fulfill({json: {
    start_date: "2026-10-01", end_date: "2026-10-31",
    metrics: {order_count: 40, net_pnl: 5.5, payoff_ratio: 1.2, win_rate: 0.5},
    r_metrics: {sample_count: 40, complete_count: 40, sqn_status: "available", sqn: 1.2, decisive_win_rate: 0.5, expectancy_r: 0.4, z_score: 0.2},
    periods: {
      yesterday: {net_pnl: -40, order_count: 3, payoff_ratio: 0.8, r_metrics: {complete_count: 3, decisive_win_rate: 1 / 3, expectancy_r: -0.2, sqn_status: "insufficient_sample"}},
      last_7_days: {net_pnl: 120, order_count: 8, payoff_ratio: 1.8, r_metrics: {complete_count: 8, decisive_win_rate: 0.625, expectancy_r: 0.4, sqn_status: "insufficient_sample"}},
      last_30_days: {net_pnl: 80, order_count: 20, payoff_ratio: 1.2, r_metrics: {complete_count: 20, decisive_win_rate: 0.55, expectancy_r: 0.15, sqn_status: "insufficient_sample"}},
      last_365_days: {net_pnl: -250, order_count: 140, payoff_ratio: 0.9, r_metrics: {complete_count: 140, decisive_win_rate: 0.48, expectancy_r: -0.05, sqn: 1.12, sqn_status: "available"}},
    }, equity: [],
    calendar: {year: 2026, month: 10, days: {"2026-10-02": {label: "2026-10-02", net_pnl: -6.4, order_count: 3, win_rate: 2 / 3}}},
    heatmap: {days: [], max_abs_pnl: 0}, sessions: {},
    system_evaluation: Array.from({length: 40}, (_, index) => ({
      date: new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10),
      net_pnl: index % 2 ? -6.4 : 5.5,
      order_count: 1,
      profit_factor: 1.2,
      payoff_ratio: 1.2,
      cash_win_rate: 0.5,
      r_metrics: {decisive_win_rate: 0.5, scratch_rate: 0, expectancy_r: 0.4, sqn_status: "available", sqn: 1.2},
    })),
    mode_evaluation: {trade_type: [], strategy: []},
  }}));
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=mt5`);
  await expect(page.locator("#calendarChart canvas")).toHaveCount(1);
  await expect(page.locator("#systemEvaluationChart canvas")).toHaveCount(1);
  await expect(page.locator(".evaluation-table tbody tr")).toHaveCount(40);
  await expect(page.locator("#systemEvaluationPagination")).toContainText("最近 30 个交易日在前");
  const systemOption = await page.evaluate(() => globalThis.echarts.getInstanceByDom(document.querySelector("#systemEvaluationChart")).getOption());
  expect(systemOption.title.map((title) => title.text)).toEqual(["总盈亏", "交易笔数", "净盈亏比", "净胜率", "数学期望", "收益稳定度"]);
  expect(systemOption.grid).toHaveLength(6);
  expect(systemOption.series).toHaveLength(6);
  expect(systemOption.series.every((series) => series.type === "bar" && series.data.length === 4)).toBe(true);
  expect(systemOption.series[1].data[1].label).toBe("8");
  const gridColumns = systemOption.grid.map((grid) => grid.left);
  if (testInfo.project.name === "mobile-390") {
    expect(new Set(gridColumns).size).toBe(1);
  } else {
    expect(gridColumns[0]).not.toBe(gridColumns[1]);
  }
  await page.evaluate(() => globalThis.echarts.getInstanceByDom(document.querySelector("#systemEvaluationChart")).dispatchAction({type: "showTip", seriesIndex: 1, dataIndex: 1}));
  await expect(page.locator("body")).toContainText("近 7 天 · 交易笔数");
  await expect(page.locator("body")).toContainText("数值：8");
  await page.evaluate(() => {
    const calendar = document.querySelector("#calendarChart");
    globalThis.echarts.getInstanceByDom(calendar).dispatchAction({type: "showTip", seriesIndex: 0, dataIndex: 0});
  });
  await expect(page.locator("body")).toContainText("订单：3 单");
  await expect(page.locator("body")).toContainText("胜率：67%");

  const visual = await page.evaluate(() => {
    const calendar = document.querySelector("#calendarChart");
    const instance = globalThis.echarts.getInstanceByDom(calendar);
    const option = instance.getOption();
    const label = option.series[0].label.formatter({value: ["2026-10-02", -6.4, 3, 2 / 3]});
    const tooltip = option.tooltip[0].formatter({value: ["2026-10-02", -6.4, 3, 2 / 3]});
    const wrapper = document.querySelector(".evaluation-table-wrap");
    const header = document.querySelector(".evaluation-table thead th");
    wrapper.scrollTop = 120;
    const headerStyle = getComputedStyle(header);
    return {
      label,
      tooltip,
      tooltipTrigger: option.tooltip[0].trigger,
      position: headerStyle.position,
      background: headerStyle.backgroundColor,
      zIndex: headerStyle.zIndex,
      headerTopOffset: header.getBoundingClientRect().top - wrapper.getBoundingClientRect().top,
      scrollTop: wrapper.scrollTop,
    };
  });
  expect(visual.label).toBe("{day|02}\n{loss|-$6}");
  expect(visual.tooltip).toContain("3 单");
  expect(visual.tooltip).toContain("胜率：67%");
  expect(visual.tooltipTrigger).toBe("item");
  expect(visual.label).not.toContain("\\n");
  expect(visual.position).toBe("sticky");
  expect(visual.background).toBe("rgb(25, 31, 40)");
  expect(Number(visual.zIndex)).toBeGreaterThanOrEqual(2);
  expect(visual.scrollTop).toBeGreaterThan(0);
  expect(Math.abs(visual.headerTopOffset)).toBeLessThan(1);
});

test("MT5 layout editing uses the live dashboard modules and persists a GridStack resize", async ({page, syntheticServer}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop GridStack editing contract");
  await page.route("**/api/analysis**", (route) => route.fulfill({json: {
    start_date: "2026-10-01", end_date: "2026-10-31",
    metrics: {order_count: 2, net_pnl: 5.5, payoff_ratio: 1.2, win_rate: 0.5},
    r_metrics: {sample_count: 2, complete_count: 2, sqn_status: "available", sqn: 1.2, decisive_win_rate: 0.5, expectancy_r: 0.4, z_score: 0.2},
    periods: {}, equity: [],
    calendar: {year: 2026, month: 10, month_net_pnl: 5.5, month_order_count: 2, month_win_rate: 0.5, days: {"2026-10-01": {label: "2026-10-01", net_pnl: 5.5, order_count: 1, win_rate: 1}}},
    heatmap: {days: [], max_abs_pnl: 0}, sessions: {}, system_evaluation: [], mode_evaluation: {trade_type: [], strategy: []},
  }}));
  await page.goto(`${syntheticServer.baseURL}/dashboard/?platform=mt5&layout=edit`);
  await expect(page.locator("#mt5LayoutEditor")).toBeVisible();
  await expect(page.locator("#calendarChart canvas")).toHaveCount(1);
  await expect(page.locator(".editor-card")).toHaveCount(0);
  await expect(page.locator("#mt5DashboardLayout > .grid-stack-item > .ui-resizable-se").first()).toBeVisible();

  const minimumCalendarHeight = await page.evaluate(() => {
    const root = document.querySelector("#mt5DashboardLayout");
    const calendar = root.querySelector('[gs-id="calendar"]');
    root.gridstack.update(calendar, {w: 1, h: 1});
    const panel = calendar.querySelector(".grid-stack-item-content > .panel");
    const chart = panel.querySelector("#calendarChart");
    const canvas = chart.querySelector("canvas");
    return {
      w: calendar.gridstackNode.w,
      h: calendar.gridstackNode.h,
      chartBottom: chart.getBoundingClientRect().bottom,
      panelBottom: panel.getBoundingClientRect().bottom,
      canvasWidth: canvas.getBoundingClientRect().width,
      canvasHeight: canvas.getBoundingClientRect().height,
      panelHeight: panel.getBoundingClientRect().height,
      headHeight: panel.querySelector(".panel-head").getBoundingClientRect().height,
      statsHeight: panel.querySelector(".calendar-stats").getBoundingClientRect().height,
      chartHeight: chart.getBoundingClientRect().height,
    };
  });
  expect(minimumCalendarHeight.w).toBe(6);
  expect(minimumCalendarHeight.h).toBe(8);
  expect(minimumCalendarHeight.chartBottom).toBeLessThanOrEqual(minimumCalendarHeight.panelBottom);
  expect(minimumCalendarHeight.canvasWidth).toBeGreaterThan(0);
  expect(minimumCalendarHeight.canvasHeight).toBeGreaterThan(0);
  await page.locator("#mt5LayoutEditor [data-layout-save]").click();
  await expect(page).toHaveURL(/platform=mt5(?:$|&)/);
  const savedLayout = await page.evaluate(() => JSON.parse(localStorage.getItem("mt5-dashboard-layout-v1")));
  expect(savedLayout.items.find((item) => item.id === "calendar")).toMatchObject({w: 6, h: 8});
  await expect(page.locator("#calendarChart canvas")).toHaveCount(1);
});
