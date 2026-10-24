import {test, expect} from "./fixtures.mjs";

const routes = [
  ["MT5 dashboard", "/dashboard/?platform=mt5"],
  ["domestic dashboard", "/dashboard/?platform=domestic_futures"],
  ["MT5 orders", "/orders/?platform=mt5"],
  ["domestic orders", "/orders/?platform=domestic_futures"],
  ["album", "/album/?platform=mt5"],
  ["settings", "/settings/?platform=mt5"],
];

for (const [pageName, route] of routes) {
  test(`${pageName} uses the shared graphite glass visual system`, async ({page, syntheticServer}) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    await page.goto(`${syntheticServer.baseURL}/a1-visual-demo/`);
    const demo = await page.evaluate(() => {
      const rect = (selector) => {
        const {x, y, width, height} = document.querySelector(selector).getBoundingClientRect();
        return {x, y, width, height};
      };
      const panel = getComputedStyle(document.querySelector(".glass-panel"));
      const windowStyle = getComputedStyle(document.querySelector(".demo-window"));
      return {
        window: rect(".demo-window"),
        sidebar: rect(".sidebar"),
        topbar: rect(".topbar"),
        primary: rect(".pill-button--primary"),
        circle: rect(".circle-button"),
        panelRadius: panel.borderRadius,
        panelShadow: panel.boxShadow,
        panelFilter: panel.backdropFilter,
        navActiveRadius: getComputedStyle(document.querySelector(".nav-link.is-active")).borderRadius,
        sidebarBackground: getComputedStyle(document.querySelector(".sidebar")).backgroundImage,
        sidebarShadow: getComputedStyle(document.querySelector(".sidebar")).boxShadow,
        windowBackground: windowStyle.backgroundImage,
        windowShadow: windowStyle.boxShadow,
        windowRadius: windowStyle.borderRadius,
        windowFilter: windowStyle.backdropFilter,
        mainSurfaceBackground: getComputedStyle(document.querySelector(".main-surface")).backgroundColor,
      };
    });

    await page.goto(`${syntheticServer.baseURL}${route}`);
    await expect(page.locator(".app-navigation")).toBeVisible();
    await expect(page.locator(".app-page-bar")).toBeVisible();

    const styles = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const shell = getComputedStyle(document.querySelector(".app-shell"));
      const body = getComputedStyle(document.body);
      const navigation = getComputedStyle(document.querySelector(".app-navigation"));
      const sidebarGlass = getComputedStyle(document.querySelector(".app-shell"), "::before");
      const navigationIcon = getComputedStyle(document.querySelector(".app-navigation__link > svg"));
      const pageBar = getComputedStyle(document.querySelector(".app-page-bar"));
      const primaryControl = [...document.querySelectorAll(".button-primary, .dashboard-layout-link, .domestic-layout-link")]
        .find((element) => element.getClientRects().length > 0);
      const panel = [...document.querySelectorAll(".panel:not(.period-overview), .domestic-module:not(.domestic-period-module)")]
        .find((element) => element.getClientRects().length > 0);
      const panelStyle = panel ? getComputedStyle(panel) : null;
      const rect = (element) => {
        const {x, y, width, height} = element.getBoundingClientRect();
        return {x, y, width, height};
      };
      const visibleCircles = [...document.querySelectorAll(".app-icon-button:not(.app-navigation__backdrop), .detail-icon-action")]
        .filter((element) => element.getClientRects().length > 0)
        .map(rect);
      const visiblePills = [...document.querySelectorAll(".button, .button-primary, .button-danger, .dashboard-layout-link, .domestic-layout-link")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const style = getComputedStyle(element);
          return {height: element.getBoundingClientRect().height, radius: style.borderRadius};
        });
      return {
        accent: root.getPropertyValue("--color-accent").trim(),
        blur: root.getPropertyValue("--glass-blur").trim(),
        shellMargin: shell.margin,
        shellRadius: shell.borderRadius,
        shellShadow: shell.boxShadow,
        shellBackgroundImage: shell.backgroundImage,
        shellFilter: shell.backdropFilter,
        atmosphereBackgroundImage: getComputedStyle(document.body, "::before").backgroundImage,
        atmosphereBlur: getComputedStyle(document.body, "::before").filter,
        shellHighlight: getComputedStyle(document.querySelector(".app-shell"), "::after").boxShadow,
        isMobile: window.innerWidth <= 720,
        navigationFilter: navigation.backdropFilter,
        navigationRadius: navigation.borderRadius,
        navigationIconRadius: navigationIcon.borderRadius,
        navigationIconBackground: navigationIcon.backgroundColor,
        pageBarFilter: pageBar.backdropFilter,
        panelFilter: panelStyle?.backdropFilter ?? "",
        panelRadius: panelStyle?.borderRadius ?? "",
        panelShadow: panelStyle?.boxShadow ?? "",
        panelBackgroundImage: panelStyle?.backgroundImage ?? "",
        panelHighlight: panel ? getComputedStyle(panel, "::before").backgroundImage : "",
        primaryRadius: primaryControl ? getComputedStyle(primaryControl).borderRadius : "",
        primaryBackground: primaryControl ? getComputedStyle(primaryControl).backgroundImage : "",
        pageBarRadius: pageBar.borderRadius,
        navigationShadow: navigation.boxShadow,
        sidebarGlassBackground: sidebarGlass.backgroundImage,
        sidebarGlassShadow: sidebarGlass.boxShadow,
        mainSurfaceBackground: getComputedStyle(document.querySelector(".app-shell__main")).backgroundColor,
        circleControls: visibleCircles,
        pillControls: visiblePills,
        shellRect: rect(document.querySelector(".app-shell")),
        navigationRect: rect(document.querySelector(".app-navigation")),
        pageBarRect: rect(document.querySelector(".app-page-bar")),
        primaryRect: primaryControl ? rect(primaryControl) : null,
        navigationActiveRadius: getComputedStyle(document.querySelector('.app-navigation__link[aria-current="page"]')).borderRadius,
        controlHeight: root.getPropertyValue("--control-height").trim(),
        bodyColorScheme: getComputedStyle(document.body).colorScheme,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    expect(styles.accent).toBe("#79c8d5");
    expect(styles.blur).toBe("38px");
    expect(styles.shellMargin).toBe(styles.isMobile ? "0px" : "12px");
    expect(styles.shellRadius).toBe(styles.isMobile ? "0px" : "28px");
    if (styles.isMobile) expect(styles.shellShadow).toBe("none");
    else expect(styles.shellShadow).toContain("48px 130px");
    expect(styles.shellBackgroundImage).toContain("linear-gradient");
    expect(styles.shellBackgroundImage).toBe(demo.windowBackground);
    expect(styles.shellShadow).toBe(demo.windowShadow);
    expect(styles.shellRadius).toBe(demo.windowRadius);
    expect(styles.shellFilter).toBe(demo.windowFilter);
    expect(styles.mainSurfaceBackground).toBe(demo.mainSurfaceBackground);
    expect(styles.atmosphereBackgroundImage).toContain("radial-gradient");
    expect(styles.atmosphereBlur).toBe("blur(30px) saturate(1.45)");
    expect(styles.shellHighlight).toContain("0.19");
    expect(styles.navigationFilter).toBe(styles.isMobile ? "blur(42px) saturate(1.85)" : "none");
    expect(styles.navigationRadius).toBe(styles.isMobile ? "28px" : "0px");
    expect(styles.navigationIconRadius).toBe("15px");
    expect(styles.navigationIconBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles.pageBarFilter).toContain("blur(20px)");
    expect(styles.pageBarRadius).toBe("0px");
    expect(styles.panelFilter).toContain("blur(32px)");
    expect(styles.panelRadius).toBe("24px");
    expect(styles.panelShadow).toContain("32px 84px");
    expect(styles.panelBackgroundImage).toContain("linear-gradient");
    expect(styles.panelHighlight).toContain("linear-gradient");
    if (styles.primaryRadius) {
      expect(styles.primaryRadius).toBe("999px");
      expect(styles.primaryBackground).toContain("linear-gradient");
    }
    expect(styles.controlHeight).toBe("42px");
    expect(styles.circleControls.every(({width, height}) => width === 42 && height === 42)).toBe(true);
    expect(styles.pillControls.every(({height, radius}) => height >= 42 && radius === "999px")).toBe(true);
    if (!styles.isMobile) expect(styles.pillControls.every(({height}) => height === 42)).toBe(true);
    if (!styles.isMobile) {
      expect(styles.shellRect.x).toBe(demo.window.x);
      expect(styles.shellRect.y).toBe(demo.window.y);
      expect(styles.shellRect.width).toBe(demo.window.width);
      expect(styles.shellRect.height).toBeGreaterThanOrEqual(976);
      expect(styles.navigationRect.x).toBe(demo.sidebar.x);
      expect(styles.navigationRect.y).toBe(demo.sidebar.y);
      expect(styles.navigationRect.width).toBe(demo.sidebar.width);
      expect(styles.navigationRect.height).toBe(976);
      expect(styles.pageBarRect.height).toBe(demo.topbar.height);
      expect(styles.navigationActiveRadius).toBe(demo.navActiveRadius);
      if (styles.primaryRect) expect(styles.primaryRect.height).toBe(demo.primary.height);
      expect(styles.sidebarGlassBackground).toBe(demo.sidebarBackground);
      expect(styles.sidebarGlassShadow).toBe(demo.sidebarShadow);
    }
    if (styles.primaryRadius) expect(styles.primaryRadius).toBe("999px");
    expect(styles.panelRadius).toBe(demo.panelRadius);
    expect(styles.panelShadow).toBe(demo.panelShadow);
    expect(styles.panelFilter).toBe(demo.panelFilter);
    expect(styles.navigationShadow).toBe("none");
    expect(styles.bodyColorScheme).toBe("dark");
    expect(styles.horizontalOverflow).toBe(false);
    expect(browserErrors).toEqual([]);

    if (pageName.includes("orders")) {
      const activeRowColor = await page.evaluate(() => {
        const row = document.createElement("tr");
        row.className = "active";
        row.innerHTML = "<td>visual contract</td>";
        document.querySelector(".orders-table tbody")?.append(row);
        return getComputedStyle(row).backgroundColor;
      });
      expect(activeRowColor).toBe("rgba(121, 200, 213, 0.14)");
    }
  });
}

test("dashboard layout editor uses the shared graphite glass visual system", async ({page, syntheticServer}) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(`${syntheticServer.baseURL}/dashboard/mock-domestic-futures-layout.html?platform=mt5&return=%2Fdashboard%2F%3Fplatform%3Dmt5`);
  await expect(page.locator(".editor-topbar")).toBeVisible();
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".inspector")).toBeVisible();

  const styles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const workspace = getComputedStyle(document.querySelector(".workspace"));
    const card = getComputedStyle(document.querySelector(".grid-stack-item-content"));
    const button = getComputedStyle(document.querySelector(".action-button.primary"));
    return {
      colorScheme: root.colorScheme,
        backgroundImage: getComputedStyle(document.body, "::before").backgroundImage,
      workspaceRadius: workspace.borderRadius,
      workspaceShadow: workspace.boxShadow,
      cardRadius: card.borderRadius,
      cardShadow: card.boxShadow,
      buttonRadius: button.borderRadius,
      buttonHeight: button.height,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  expect(styles.colorScheme).toBe("dark");
  expect(styles.backgroundImage).toContain("radial-gradient");
  expect(styles.workspaceRadius).toBe("24px");
  expect(styles.workspaceShadow).toContain("rgba(0, 0, 0");
  expect(styles.cardRadius).toBe("24px");
  expect(styles.cardShadow).toContain("rgba(0, 0, 0");
  expect(styles.buttonRadius).toBe("999px");
  expect(styles.buttonHeight).toBe("42px");
  const editorCircleSize = await page.locator(".editor-card-actions button").first().evaluate((button) => {
    const style = getComputedStyle(button);
    return `${style.width}/${style.height}/${style.borderRadius}`;
  });
  expect(editorCircleSize).toBe("42px/42px/50%");
  expect(styles.overflow).toBe(false);
  expect(browserErrors).toEqual([]);
});
