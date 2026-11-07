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
      const visibleCircles = [...document.querySelectorAll(".app-icon-button, .detail-icon-action")]
        .filter((element) => !element.classList.contains("app-navigation__backdrop") && !element.classList.contains("detail-checkin-pill") && !element.closest(".app-page-bar__actions") && element.getClientRects().length > 0)
        .map((element) => {
          const style = getComputedStyle(element);
          const bounds = rect(element);
          return {...bounds, styleWidth: parseFloat(style.width), styleHeight: parseFloat(style.height)};
        });
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
        panelBackgroundColor: panelStyle?.backgroundColor ?? "",
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
    const orderCanvas = pageName.includes("orders") || pageName === "album";
    expect(styles.shellMargin).toBe(styles.isMobile ? "0px" : "12px");
    if (orderCanvas) {
      expect(styles.shellRadius).toBe("0px");
      expect(styles.shellShadow).toBe("none");
    } else {
      expect(styles.shellRadius).toBe(styles.isMobile ? "0px" : "28px");
      if (styles.isMobile) expect(styles.shellShadow).toBe("none");
      else expect(styles.shellShadow).toContain("48px 130px");
    }
    expect(styles.shellBackgroundImage === "none" || styles.shellBackgroundImage === demo.windowBackground).toBe(true);
    if (!orderCanvas) {
      expect(styles.shellShadow).toBe(demo.windowShadow);
      expect(styles.shellRadius).toBe(demo.windowRadius);
    }
    if (orderCanvas) expect(styles.shellFilter).toBe("none");
    else expect(styles.shellFilter).toBe(demo.windowFilter);
    if (!orderCanvas) expect(styles.mainSurfaceBackground).toBe(demo.mainSurfaceBackground);
    expect(styles.atmosphereBackgroundImage === "none" || styles.atmosphereBackgroundImage.includes("radial-gradient")).toBe(true);
    expect(styles.atmosphereBlur).toBe("blur(30px) saturate(1.45)");
    expect(styles.shellHighlight).toContain("0.19");
    expect(styles.navigationFilter).toBe("blur(32px) saturate(1.75)");
    expect(styles.navigationRadius).toBe("28px");
    expect(styles.navigationIconRadius).toBe("50%");
    expect(styles.navigationIconBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles.pageBarFilter).toBe("none");
    expect(styles.pageBarRadius).toBe("0px");
    if (!orderCanvas) {
      expect(styles.panelFilter).toContain("blur(32px)");
      expect(styles.panelRadius).toBe("24px");
      expect(styles.panelShadow).toContain("24px 64px");
      expect(styles.panelBackgroundImage === "none" || styles.panelBackgroundImage.includes("linear-gradient") || styles.panelBackgroundColor.includes("27, 43, 56")).toBe(true);
      expect(styles.panelHighlight).toMatch(/(?:linear|conic)-gradient/);
    }
    if (styles.primaryRadius) {
      expect(styles.primaryRadius).toBe("999px");
      expect(styles.primaryBackground).toContain("linear-gradient");
    }
    expect(styles.controlHeight).toBe("42px");
    expect(styles.circleControls.every(({styleWidth, styleHeight}) => styleWidth === styleHeight && styleWidth >= 20 && styleWidth <= 42)).toBe(true);
    expect(styles.pillControls.every(({height, radius}) => height >= 42 && radius === "999px")).toBe(true);
    if (!styles.isMobile) expect(styles.pillControls.every(({height}) => height === 42)).toBe(true);
    if (!styles.isMobile) {
      if (!orderCanvas) {
        expect(Math.abs(styles.shellRect.x - demo.window.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(styles.shellRect.y - demo.window.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(styles.shellRect.width - demo.window.width)).toBeLessThanOrEqual(2);
        expect(styles.shellRect.height).toBeGreaterThanOrEqual(900);
      }
      if (!orderCanvas) {
        expect(Math.abs(styles.navigationRect.x - 25)).toBeLessThanOrEqual(2);
        expect(Math.abs(styles.navigationRect.y - 25)).toBeLessThanOrEqual(2);
        expect(styles.navigationRect.width).toBeGreaterThanOrEqual(140);
        expect(styles.navigationRect.width).toBeLessThanOrEqual(164);
        expect(styles.navigationRect.height).toBeGreaterThanOrEqual(880);
        expect(styles.pageBarRect.height).toBeGreaterThanOrEqual(48);
        expect(styles.navigationActiveRadius).toBe(demo.navActiveRadius);
        if (styles.primaryRect) expect(styles.primaryRect.height).toBe(demo.primary.height);
        expect(styles.sidebarGlassBackground).toContain("linear-gradient");
        expect(styles.sidebarGlassShadow).toContain("20px");
      }
    }
    if (styles.primaryRadius) expect(styles.primaryRadius).toBe("999px");
    if (!orderCanvas) {
      expect(styles.panelRadius).toBe(demo.panelRadius);
      expect(styles.panelShadow).toBe(demo.panelShadow);
      expect(styles.panelFilter).toBe(demo.panelFilter);
    }
    expect(styles.navigationShadow).toContain("30px 84px");
    expect(styles.bodyColorScheme).toBe("dark");
    expect(styles.horizontalOverflow).toBe(false);
    expect(browserErrors).toEqual([]);

    if (pageName.includes("orders")) {
      if (pageName === "MT5 orders") {
        const orderListGlass = await page.evaluate(() => {
          const card = document.querySelector(".campaign-day-card");
          const cardStyle = getComputedStyle(card);
          const edgeStyle = getComputedStyle(card, "::before");
          const reflectionStyle = getComputedStyle(card, "::after");
          const headerStyle = getComputedStyle(card.querySelector(".campaign-day-header"));
          const list = document.querySelector(".order-card-list");
          const selectedRow = document.createElement("div");
          selectedRow.className = "campaign-row campaign-card-order active";
          selectedRow.innerHTML = '<div class="campaign-order-cell"><div class="campaign-list-order"><span class="campaign-list-contract">selected order</span></div></div>';
          list.append(selectedRow);
          const selectedStyle = getComputedStyle(selectedRow.querySelector(".campaign-list-order"));
          const selected = {
            backgroundImage: selectedStyle.backgroundImage,
            borderColor: selectedStyle.borderColor,
            borderRadius: selectedStyle.borderRadius,
            boxShadow: selectedStyle.boxShadow,
            filter: selectedStyle.backdropFilter,
            textShadow: getComputedStyle(selectedRow.querySelector(".campaign-list-contract") || selectedRow.querySelector(".campaign-list-order")).textShadow,
          };
          selectedRow.remove();
          const moduleSelectors = [
            ["title", ".order-detail-title"],
            ["screenshot", ".order-screenshot-stage"],
            ["classification", ".detail-review-meta"],
            ["review", ".review-editor-panel"],
            ["executions", ".execution-section"],
            ["source", ".import-source-section.is-secondary"],
            ["checkin", ".checkin-calendar-panel"],
          ];
          const modules = moduleSelectors.flatMap(([name, selector]) => {
            const element = document.querySelector(selector);
            if (!element || !element.getClientRects().length) return [];
            const style = getComputedStyle(element);
            return [{name, borderColor: style.borderColor, borderRadius: style.borderRadius, boxShadow: style.boxShadow}];
          });
          return {
            backgroundColor: cardStyle.backgroundColor,
            backgroundImage: cardStyle.backgroundImage,
            borderColor: cardStyle.borderColor,
            borderRadius: cardStyle.borderRadius,
            boxShadow: cardStyle.boxShadow,
            filter: cardStyle.backdropFilter,
            edgeImage: edgeStyle.backgroundImage,
            edgeOpacity: edgeStyle.opacity,
            reflectionImage: reflectionStyle.backgroundImage,
            reflectionShadow: reflectionStyle.boxShadow,
            headerImage: headerStyle.backgroundImage,
            selected,
            modules,
          };
        });
        expect(orderListGlass.backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(orderListGlass.borderRadius).toBe("20px");
        expect(orderListGlass.backgroundImage).toContain("linear-gradient");
        expect(orderListGlass.borderColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(orderListGlass.edgeImage).toContain("conic-gradient");
        expect(Number(orderListGlass.edgeOpacity)).toBeGreaterThanOrEqual(0.9);
        expect(orderListGlass.reflectionImage).toContain("linear-gradient");
        expect(orderListGlass.reflectionShadow).toContain("rgba(");
        expect(orderListGlass.headerImage).toContain("linear-gradient");
        expect(orderListGlass.filter).toContain("blur(18px)");
        expect(orderListGlass.boxShadow).toContain("inset");
        expect(orderListGlass.boxShadow).toContain("0px -3px");
        expect(orderListGlass.selected.backgroundImage).toContain("linear-gradient");
        expect(orderListGlass.selected.borderColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(orderListGlass.selected.borderRadius).toBe("999px");
        expect(orderListGlass.selected.boxShadow).toContain("0px 0px 16px");
        expect(orderListGlass.selected.filter).toContain("blur(12px)");
        expect(orderListGlass.selected.textShadow).toContain("rgba(209, 251, 255, 0.32)");
        expect(orderListGlass.modules.length).toBeGreaterThanOrEqual(styles.isMobile ? 1 : 6);
        expect(orderListGlass.modules.every(({borderColor, borderRadius, boxShadow}) =>
          borderColor !== "rgba(0, 0, 0, 0)" && borderRadius === "20px" && boxShadow.includes("inset"),
        )).toBe(true);
      }
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
  expect(styles.backgroundImage === "none" || styles.backgroundImage.includes("radial-gradient")).toBe(true);
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
