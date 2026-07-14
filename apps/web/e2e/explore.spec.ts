import { expect, test } from "@playwright/test";

test.describe("explore", () => {
  test("primary navigation consolidates NFL content into the sports home", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByText("Sports", { exact: true })).toBeVisible();
    for (const label of ["NFL", "Scores", "Glossary", "Fantasy Builder AI"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    for (const removed of ["Search", "Teams", "Standings", "Leaders", "Fantasy", "Assistant"]) {
      await expect(nav.getByRole("link", { name: removed, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "Performers of the week" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Division leaders" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Top fantasy performers" })).toBeVisible();
  });

  test("team list drills into a season-aware team page and out to a player", async ({ page }) => {
    await page.goto("/teams?season=2023");
    await page.getByRole("link", { name: /49ers/ }).click();

    await expect(page).toHaveURL(/\/teams\/SF\?season=2023/);
    await expect(page.getByRole("heading", { name: "San Francisco 49ers" })).toBeVisible();
    // Real 2023: 12-5, NFC West champs.
    await expect(page.getByRole("region", { name: "San Francisco 49ers profile" })).toContainText(
      "12-5",
    );
    await expect(page.getByText("Team leaders")).toBeVisible();

    // Leaders card → player page, carrying the season along.
    await page.locator(".yb-leader-card").first().click();
    await expect(page).toHaveURL(/\/players\/.+season=2023/);
  });

  test("season switch updates the team page in place", async ({ page }) => {
    await page.goto("/teams/SF?season=2023");
    const profile = page.getByRole("region", { name: "San Francisco 49ers profile" });
    await expect(profile).toContainText("12-5");

    await page.getByRole("button", { name: "Select season" }).click();
    await page.getByRole("option", { name: "2024 season" }).click();
    await expect(page).toHaveURL(/season=2024/);
    // Real 2024: the 49ers fell to 6-11.
    await expect(profile).toContainText("6-11");
  });

  test("standings rows link to team pages with the season preserved", async ({ page }) => {
    await page.goto("/standings?season=2023");
    await page.getByRole("link", { name: /Buffalo Bills/ }).click();

    await expect(page).toHaveURL(/\/teams\/BUF\?season=2023/);
    await expect(page.locator(".yb-entity-hero")).toContainText("11-6");
  });

  test("leaders hub filters by position and exposes team rankings", async ({ page }) => {
    await page.goto("/leaders?season=2023");
    await expect(page.getByRole("heading", { name: "League Leaders" })).toBeVisible();

    await page.getByRole("button", { name: "Select leaderboard category" }).click();
    await page.getByRole("option", { name: "Rushing Yards" }).click();
    await page.getByRole("button", { name: "Filter by position" }).click();
    await page.getByRole("option", { name: "RB" }).click();
    await expect(page.locator(".yb-board-top")).toContainText("Christian McCaffrey");

    await page.getByRole("button", { name: "Select leaderboard category" }).click();
    await page.getByRole("option", { name: "Team rankings" }).click();
    const firstTeam = page.locator("tbody tr").first();
    await expect(firstTeam).toContainText("Baltimore Ravens"); // best 2023 record by pct/diff
    await firstTeam.getByRole("link").click();
    await expect(page).toHaveURL(/\/teams\/BAL/);
  });

  test("scores page makes games primary and keeps performers below the board", async ({ page }) => {
    await page.goto("/scores?season=2023&week=1");

    const games = page.getByRole("heading", { name: "Games" });
    const performers = page.getByRole("heading", { name: "Performers of the week" });
    await expect(games).toBeVisible();
    await expect(performers).toBeVisible();

    const order = await page.evaluate(() => {
      const gameTop = document.querySelector('[data-section="games"]')?.getBoundingClientRect().top ?? 0;
      const perfTop =
        document.querySelector('[data-section="performers"]')?.getBoundingClientRect().top ?? 0;
      return gameTop < perfTop;
    });
    expect(order).toBe(true);
    await expect(page.getByRole("button", { name: "Previous week" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();
  });

  test("final results use compact box scores and the winner's team color", async ({ page }) => {
    await page.goto("/scores?season=2023&week=1");

    const firstFinal = page.locator(".yb-game-card").first();
    await expect(firstFinal.locator(".yb-mini-boxscore")).toBeVisible();
    await expect(firstFinal.locator(".yb-game-result-row")).toHaveCount(2);
    const winner = firstFinal.locator(".yb-game-result-row.winner");
    const winnerTheme = await winner.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      accent: getComputedStyle(node).getPropertyValue("--accent").trim(),
      color: getComputedStyle(node).color,
    }));
    expect(winnerTheme.background).not.toBe("rgb(25, 195, 125)");
    expect(winnerTheme.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(winnerTheme.accent).not.toBe("");

    await firstFinal.getByRole("link", { name: "Full box score" }).click();
    await expect(page.locator(".yb-boxscore-summary")).toBeVisible();
    await expect(page.locator(".yb-boxscore-summary .yb-boxscore-row")).toHaveCount(2);
    await expect(page.locator(".yb-team-box")).toHaveCount(2);
  });

  test("fantasy page labels production honestly and exposes explicit optimizer", async ({ page }) => {
    await page.goto("/fantasy?season=2023");

    await expect(page.getByText("Actual PPR per game")).toBeVisible();
    await expect(page.getByText("Season PPR points")).toBeVisible();
    await expect(page.getByRole("button", { name: "Optimize by PPR average" })).toBeVisible();
    await expect(page.getByLabel("Scoring format")).toHaveText(/PPR/);
  });

  test("player page filters the game log by season", async ({ page }) => {
    await page.goto("/players/00-0033873?season=2022"); // Mahomes
    await expect(page.getByRole("heading", { name: "Patrick Mahomes" })).toBeVisible();
    // Position rank pulled from the URL season.
    await expect(page.getByRole("region", { name: "Patrick Mahomes profile" })).toContainText(
      "QB #1 of",
    );

    // The filterable log lives on the Game Log tab.
    await page.getByRole("tab", { name: "Game Log" }).click();
    const qbTable = page.locator("table").first();
    await expect(qbTable.getByRole("columnheader", { name: "Cmp/Att" })).toBeVisible();
    await expect(qbTable.getByRole("columnheader", { name: "Rating" })).toBeVisible();
    await expect(qbTable.getByRole("columnheader", { name: "Rec yds" })).toHaveCount(0);
    const logRows = page.locator("table").first().locator("tbody tr");
    await expect(logRows.first()).toBeVisible();
    const count = await logRows.count();
    expect(count).toBeLessThan(30); // one season, not the whole career

    await page.getByRole("button", { name: "Filter game log by season" }).click();
    await page.getByRole("option", { name: "All seasons" }).click();
    expect(await logRows.count()).toBeGreaterThan(count);
  });

  test("player game logs use the player's positional stat family", async ({ page }) => {
    await page.goto("/players/00-0036875?season=2025"); // Rhamondre Stevenson
    await page.getByRole("tab", { name: "Game Log" }).click();
    const table = page.locator("table").first();
    for (const heading of ["Carries", "Rush yds", "Rush TD", "Rec", "Rec yds", "Rec TD"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    await expect(table.getByRole("columnheader", { name: "Pass yds" })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Tackles" })).toHaveCount(0);
  });

  test("player information is arranged as a responsive profile workspace", async ({ page }) => {
    await page.goto("/players/00-0033873?season=2022");

    const profile = page.getByRole("region", { name: "Patrick Mahomes profile" });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole("heading", { name: "Patrick Mahomes" })).toBeVisible();
    await expect(profile).toContainText("Kansas City Chiefs");
    await expect(page.getByRole("region", { name: "2022 season summary" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Career summary" })).toBeVisible();
    const themedPresentation = await page.evaluate(() => {
      const profile = document.querySelector<HTMLElement>(".yb-entity-hero")!;
      const summaries = Array.from(document.querySelectorAll<HTMLElement>(".yb-stat-summary"));
      const headshot = profile.querySelector<HTMLImageElement>("img.yb-avatar")!;
      const media = profile.querySelector<HTMLElement>(".yb-entity-hero-media")!;
      const headshotRect = headshot.getBoundingClientRect();
      return {
        profileBackground: getComputedStyle(profile).backgroundColor,
        profileBorder: getComputedStyle(profile).borderTopWidth,
        summaryBackgrounds: summaries.map((summary) => getComputedStyle(summary).backgroundColor),
        summaryBorders: summaries.map((summary) => getComputedStyle(summary).borderTopWidth),
        summaryValueColor: getComputedStyle(
          summaries[0]!.querySelector(".yb-stat-summary-value")!,
        ).color,
        headshotSrc: headshot.currentSrc || headshot.src,
        headshotWidth: headshotRect.width,
        headshotHeight: headshotRect.height,
        headshotFit: getComputedStyle(headshot).objectFit,
        headshotRadius: getComputedStyle(headshot).borderRadius,
        mediaBorder: getComputedStyle(media).borderTopWidth,
        mediaBackground: getComputedStyle(media).backgroundColor,
        mediaRadius: getComputedStyle(media).borderRadius,
      };
    });
    expect(themedPresentation.profileBackground).toBe("rgb(227, 24, 55)");
    expect(themedPresentation.profileBorder).toBe("0px");
    expect(themedPresentation.summaryBackgrounds).toEqual([
      "rgb(227, 24, 55)",
      "rgb(227, 24, 55)",
    ]);
    expect(themedPresentation.summaryBorders).toEqual(["0px", "0px"]);
    expect(themedPresentation.summaryValueColor).toBe("rgb(255, 255, 255)");
    expect(themedPresentation.headshotSrc).toContain("w=588");
    expect(themedPresentation.headshotSrc).not.toContain("h=");
    expect(themedPresentation.headshotWidth).toBe(196);
    expect(themedPresentation.headshotHeight).toBe(246);
    expect(themedPresentation.headshotFit).toBe("contain");
    expect(themedPresentation.headshotRadius).toBe("0px");
    expect(themedPresentation.mediaBorder).toBe("0px");
    expect(themedPresentation.mediaBackground).toBe("rgba(0, 0, 0, 0)");
    expect(themedPresentation.mediaRadius).toBe("0px");
    await expect
      .poll(() =>
        profile.locator("img.yb-avatar").evaluate((image: HTMLImageElement) =>
          image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true);

    const desktopColumns = await page.locator(".yb-profile-workspace").evaluate((node) =>
      getComputedStyle(node).gridTemplateColumns,
    );
    expect(desktopColumns.split(" ")).toHaveLength(2);
    const desktopOverflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      content:
        document.querySelector<HTMLElement>(".yb-profile-main")!.scrollWidth -
        document.querySelector<HTMLElement>(".yb-profile-main")!.clientWidth,
    }));
    expect(desktopOverflow).toEqual({ page: 0, content: 0 });

    await page.setViewportSize({ width: 1024, height: 820 });
    const compactDesktop = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector<HTMLElement>(".yb-profile-workspace")!)
        .gridTemplateColumns.split(" ").length,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableOverflow:
        document.querySelector<HTMLElement>(".yb-profile-main")!.scrollWidth -
        document.querySelector<HTMLElement>(".yb-profile-main")!.clientWidth,
    }));
    expect(compactDesktop).toEqual({ columns: 1, pageOverflow: 0, tableOverflow: 0 });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileColumns = await page.locator(".yb-profile-workspace").evaluate((node) =>
      getComputedStyle(node).gridTemplateColumns,
    );
    expect(mobileColumns.split(" ")).toHaveLength(1);
    const mobileTabs = await page.locator(".yb-player-tabs").evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      buttonHeights: Array.from(node.querySelectorAll("button")).map(
        (button) => button.getBoundingClientRect().height,
      ),
    }));
    expect(mobileTabs.height).toBeLessThanOrEqual(46);
    expect(Math.min(...mobileTabs.buttonHeights)).toBeGreaterThanOrEqual(44);
    const mobileHeadshotWidth = await profile.locator("img.yb-avatar").evaluate(
      (image) => image.getBoundingClientRect().width,
    );
    expect(mobileHeadshotWidth).toBeGreaterThanOrEqual(110);
  });

  test("player details align with identity and profile controls use the darker team shade", async ({
    page,
  }) => {
    await page.goto("/players/00-0033873?season=2022");
    await expect(page.locator(".yb-player-profile")).toBeVisible();

    const desktop = await page.evaluate(() => {
      const profile = document.querySelector<HTMLElement>(".yb-player-profile")!;
      const copy = profile.querySelector<HTMLElement>(".yb-entity-hero-copy")!;
      const details = profile.querySelector<HTMLElement>(".yb-info-grid")!;
      const dropdown = profile.querySelector<HTMLElement>(".yb-dd-btn")!;
      return {
        copyX: copy.getBoundingClientRect().x,
        detailsX: details.getBoundingClientRect().x,
        dropdownBackground: getComputedStyle(dropdown).backgroundColor,
        dropdownColor: getComputedStyle(dropdown).color,
      };
    });
    expect(Math.abs(desktop.copyX - desktop.detailsX)).toBeLessThanOrEqual(1);
    expect(desktop.dropdownBackground).toBe("rgb(177, 19, 43)");
    expect(desktop.dropdownColor).toBe("rgb(255, 255, 255)");

    await page.getByRole("button", { name: "Select season" }).click();
    const menuBackground = await page
      .getByRole("listbox", { name: "Select season" })
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(menuBackground).toBe("rgb(177, 19, 43)");

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => {
      const profile = document.querySelector<HTMLElement>(".yb-player-profile")!;
      const details = profile.querySelector<HTMLElement>(".yb-info-grid")!;
      return {
        profileX: profile.getBoundingClientRect().x,
        detailsX: details.getBoundingClientRect().x,
        padding: Number.parseFloat(getComputedStyle(profile).paddingLeft),
      };
    });
    expect(Math.abs(mobile.detailsX - mobile.profileX - mobile.padding)).toBeLessThanOrEqual(1);
  });

  test("team detail uses the shared entity profile hierarchy", async ({ page }) => {
    await page.goto("/teams/SF?season=2023");

    const profile = page.getByRole("region", { name: "San Francisco 49ers profile" });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole("heading", { name: "San Francisco 49ers" })).toBeVisible();
    await expect(profile).toContainText("NFC West");
    await expect(page.getByRole("region", { name: "2023 season summary" })).toBeVisible();
  });

  test("profile card headers use sentence case", async ({ page }) => {
    await page.goto("/players/00-0033873?season=2022");
    await expect(page.getByRole("region", { name: "Patrick Mahomes profile" })).toBeVisible();

    const transforms = await page.evaluate(() =>
      [".yb-entity-eyebrow", ".yb-info-grid dt", ".yb-stat-summary dt"].map((selector) =>
        getComputedStyle(document.querySelector(selector)!).textTransform,
      ),
    );
    expect(transforms).toEqual(["none", "none", "none"]);
  });

  test("Geist is the only rendered application typeface", async ({ page }) => {
    await page.goto("/players/00-0033873?season=2022");
    await page.evaluate(() => document.fonts.ready);

    const metric = page.locator(".yb-stat-summary-value").first();
    await expect(metric).toBeVisible();
    const families = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
      metric: getComputedStyle(document.querySelector(".yb-stat-summary-value")!).fontFamily,
    }));
    expect(families.body).toContain("Geist");
    expect(families.heading).toBe(families.body);
    expect(families.metric).toBe(families.body);
  });
});
