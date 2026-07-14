import { expect, test } from "@playwright/test";

const heroSearch = (page: import("@playwright/test").Page) =>
  page.getByRole("combobox", { name: "Search NFL stats, players, and teams" });

test.describe("search", () => {
  test("question returns an answer card with linked player rows", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who threw the most touchdowns in 2023?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-answer")).toContainText("passing touchdowns in 2023");
    // Real 2023 leader, linked to his player page.
    const topRow = page.locator(".yb-query-result tbody a").first();
    await expect(topRow).toHaveText("Dak Prescott");
    await expect(topRow).toHaveAttribute("href", /\/players\//);
    // The raw player_id column stays hidden.
    await expect(page.locator(".yb-query-result thead")).not.toContainText("player id");
  });

  test("typeahead jumps straight to a player page", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("mahom");
    await page.locator(".yb-suggest-item.player").filter({ hasText: "Patrick Mahomes" }).click();

    await expect(page).toHaveURL(/\/players\/00-0033873/);
    await expect(page.getByRole("heading", { name: "Patrick Mahomes" })).toBeVisible();
  });

  test("inner pages keep the anchored search available without duplicating the brand", async ({ page }) => {
    await page.goto("/standings");

    await expect(heroSearch(page)).toBeVisible();
    await expect(page.locator(".yb-search-utility")).toHaveCSS("position", "sticky");
    await expect(page.locator(".yb-search-wordmark")).toHaveCount(0);
  });

  test("player comparison renders a head-to-head table on real stats", async ({ page }) => {
    await page.goto(
      `/?q=${encodeURIComponent("josh allen post season first 5 games versus drake maye first 5")}`,
    );

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    const compare = page.locator(".yb-player-comparison");
    await expect(compare).toBeVisible();
    await expect(compare).toContainText("Josh Allen");
    await expect(compare).toContainText("Drake Maye");
    await expect(compare.getByRole("columnheader", { name: "Metric" })).toBeVisible();
    await expect(compare).toContainText("Passing yards per game");
    await expect(compare.locator(".yb-comparison-summary")).toContainText(/same 5 games/i);
    await expect(compare.locator(".yb-cmp-row")).toHaveCount(0);
  });

  test("single-player season totals use a concise answer instead of a one-row table", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("How many passing yards did Peyton Manning have in 2013?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    const answer = page.locator(".yb-single-player-answer");
    await expect(answer).toBeVisible();
    await expect(answer.locator(".yb-single-response-label")).toHaveText("Response");
    await expect(answer.locator(".yb-single-response")).toHaveText(
      "Peyton Manning had 5,477 passing yards in the 2013 regular season.",
    );
    await expect(answer.locator(".yb-single-player-strip")).toContainText("Peyton Manning");
    await expect(answer.locator(".yb-single-player-strip")).toContainText("QB · Denver Broncos");
    await expect(answer.locator(".yb-single-player-strip")).toContainText("2013 regular season");
    await expect(answer.getByRole("heading", { name: "2013 Passing stats" })).toBeVisible();
    for (const label of ["Games", "Comp/Att", "Comp%", "Pass yds", "Pass TD", "INT", "Rating"]) {
      await expect(answer.getByRole("columnheader", { name: label })).toBeVisible();
    }
    await expect(answer.locator("th.is-query-metric")).toHaveText("Pass yds");
    await expect(answer.locator("td.is-query-metric")).toHaveText("5,477");
    await expect(answer).toContainText(/#1|1st/);
    await expect(answer.getByRole("link", { name: "View 2013 game log" })).toBeVisible();
    await expect(answer.getByRole("link", { name: "View profile" })).toBeVisible();
    await expect(answer.getByText("How this result was calculated")).toBeVisible();
    await expect(page.getByText("Query interpretation")).toHaveCount(0);
    await expect(page.locator(".yb-result-kicker")).toHaveCount(0);
    await expect(answer.locator("table")).toHaveCount(1);
  });

  test("broad comparisons default to rates and compare metrics directionally", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("Drake Maye vs Tom Brady");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    const comparison = page.locator(".yb-player-comparison");
    await expect(comparison).toBeVisible();
    await expect(comparison).toContainText(
      "Career lengths differ significantly, so rate and efficiency statistics are shown by default.",
    );
    await expect(page.getByRole("button", { name: "Career rates" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const heading of ["Metric", "Drake Maye", "Tom Brady", "Edge or winner"]) {
      await expect(comparison.getByRole("columnheader", { name: heading })).toBeVisible();
    }
    await expect(comparison).toContainText("23 seasons · NE, TB");
    await expect(comparison).toContainText("Interception rate");
    await expect(comparison).toContainText("Passing yards per game");
    await expect(comparison).not.toContainText("Fantasy points");
    await expect(comparison).not.toContainText("Receiving yards");
    await expect(comparison).not.toContainText("Tackles");

    await page.getByRole("button", { name: "First 30 games" }).click();
    await expect(comparison).toContainText(/same 30 games|first 30 games/i);
    await page.getByRole("button", { name: "Career totals" }).click();
    await expect(comparison).toContainText(/substantially longer career/i);

    await expect(comparison.getByRole("link", { name: "View Drake Maye profile" })).toBeVisible();
    await expect(comparison.getByRole("link", { name: "View Tom Brady profile" })).toBeVisible();
    await expect(comparison.getByRole("button", { name: "Compare game logs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share comparison" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download comparison image" })).toBeVisible();

    const headshots = comparison.locator(".yb-comparison-identity .yb-avatar");
    await expect(headshots).toHaveCount(2);
    const geometry = await headshots.first().evaluate((image) => ({
      width: image.getBoundingClientRect().width,
      height: image.getBoundingClientRect().height,
      fit: getComputedStyle(image).objectFit,
      radius: getComputedStyle(image).borderRadius,
    }));
    expect(geometry).toEqual({ width: 72, height: 72, fit: "cover", radius: "50%" });
  });

  test("home suggestions run supported questions with structured result actions", async ({ page }) => {
    await page.goto("/");

    const question = "Who threw the most touchdowns in 2024?";
    await heroSearch(page).fill(question);
    const sample = page.locator(".yb-suggest-item").filter({ hasText: question }).first();
    await expect(sample).toBeVisible();
    await sample.click();

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-query-result")).toBeVisible();
    await expect(page.getByText("Query interpretation")).toBeVisible();
    await expect(page.getByRole("button", { name: /Show query/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
    await page.getByRole("link", { name: "New search" }).click();
    await heroSearch(page).focus();
    await expect(page.locator(".yb-suggest-item.question").first()).toContainText(question);
  });

  test("nested examples run a query and return as the first recent suggestion", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).focus();
    const suggestion = page.locator(".yb-suggest-item.question").first();
    const question = await suggestion.locator(".nm").textContent();
    await suggestion.click();

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-result-canvas")).toBeVisible();
    await page.getByRole("link", { name: "New search" }).click();
    await heroSearch(page).focus();
    await expect(page.locator(".yb-suggest-item.question").first()).toContainText(question!);
  });

  test("compact search nests question-bank suggestions and accepts an inline completion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const search = heroSearch(page);
    const inputHeight = await search.evaluate((node) => node.getBoundingClientRect().height);
    expect(inputHeight).toBeLessThanOrEqual(56);
    await expect(page.locator(".yb-query-prompt")).toHaveCount(0);

    await search.focus();
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
    await expect(page.getByRole("option").first()).toBeVisible();

    await search.fill("Most rush");
    const completion = page.getByRole("option", { name: /Most rushing yards in a season/i });
    await expect(completion).toBeVisible();
    await completion.hover();
    await search.press("Tab");
    await expect(search).toHaveValue("Most rushing yards in a season");
    await expect(page.locator(".yb-answer")).toHaveCount(0);
    await search.press("Enter");
    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-answer")).toBeVisible();
  });

  test("completed results have a persistent dedicated page and clean PNG export", async ({
    page,
  }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who threw the most touchdowns in 2023?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    const resultUrl = page.url();
    await expect(page.getByRole("heading", { name: "Who threw the most touchdowns in 2023?" })).toBeVisible();
    await expect(page.locator(".yb-result-page")).toBeVisible();
    await expect(page.getByRole("link", { name: "New search" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download PNG" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Performers of the week" })).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(resultUrl);
    await expect(page.locator(".yb-answer")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG" }).click();
    await expect((await download).suggestedFilename()).toMatch(/^yunoball-.+\.png$/);
  });

  test("tied playoff leaders get comparison and game-log drill-downs without embedded profiles", async ({
    page,
  }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who threw the most touchdowns in the playoffs in 2024?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-answer")).toContainText(/are tied.*5 passing touchdowns/i);
    await expect(page.locator(".yb-result-leader-card")).toHaveCount(3);
    await expect(page.locator(".yb-result-leader-card").getByRole("link", { name: "View full profile" })).toHaveCount(3);
    await expect(page.getByRole("tab", { name: "Leaderboard" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".yb-result-ranked-table")).toBeVisible();
    await expect(page.locator(".yb-result-ranked-table").getByRole("link", { name: "View full profile" })).toHaveCount(10);

    await page.getByRole("tab", { name: "Leader comparison" }).click();
    const comparison = page.locator(".yb-leader-comparison");
    await expect(comparison).toBeVisible();
    for (const heading of [
      "Games played",
      "Completions",
      "Attempts",
      "Passing yards",
      "Passing touchdowns",
      "Interceptions",
      "Passer rating",
      "Passing TDs per game",
    ]) {
      await expect(comparison.getByRole("columnheader", { name: heading })).toBeVisible();
    }
    await expect(comparison.locator("tbody tr")).toHaveCount(3);

    await page.getByRole("tab", { name: "Game logs" }).click();
    await expect(page.getByRole("button", { name: "Select leader" })).toBeVisible();
    await page.getByRole("button", { name: "Select leader" }).click();
    await page.getByRole("option", { name: "Jayden Daniels" }).click();
    await expect(page.locator(".yb-result-game-log")).toContainText("Jayden Daniels");
    await expect(page.locator(".yb-result-game-log tbody tr").first()).toBeVisible();
    await expect(page.getByText("Height", { exact: true })).toHaveCount(0);
    await expect(page.getByText("College", { exact: true })).toHaveCount(0);
  });

  test("leader supporting fields follow the query's metric family", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who rushed for the most yards in 2024?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await page.getByRole("tab", { name: "Leader comparison" }).click();
    const comparison = page.locator(".yb-leader-comparison");
    await expect(comparison.getByRole("columnheader", { name: "Carries" })).toBeVisible();
    await expect(comparison.getByRole("columnheader", { name: "Rushing yards" })).toBeVisible();
    await expect(comparison.getByRole("columnheader", { name: "Yards per carry" })).toBeVisible();
    await expect(
      comparison.getByRole("columnheader", { name: "Passing touchdowns" }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Game logs" }).click();
    const gameLog = page.locator(".yb-result-game-log");
    await expect(gameLog.getByRole("columnheader", { name: "Carries" })).toBeVisible();
    await expect(gameLog.getByRole("columnheader", { name: "Rush yds" })).toBeVisible();
    await expect(gameLog.getByRole("columnheader", { name: "Pass yds" })).toHaveCount(0);
  });

  test("sports data leads the home page instead of a giant search hero", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Performers of the week" })).toBeVisible();
    await expect(page.locator(".yb-search-icon")).toBeVisible();
    const layout = await page.evaluate(() => {
      const search = document.querySelector<HTMLElement>(".yb-search-utility")!;
      const schedule = document.querySelector<HTMLElement>(".yb-ticker")!;
      const performers = document.querySelector<HTMLElement>(
        '[aria-label="Performers of the week"]',
      )!;
      return {
        searchHeight: search.getBoundingClientRect().height,
        searchTop: search.getBoundingClientRect().top,
        scheduleTop: schedule.getBoundingClientRect().top,
        scheduleRadius: getComputedStyle(schedule).borderRadius,
        performersTop: performers.getBoundingClientRect().top,
      };
    });
    expect(layout.searchHeight).toBeLessThanOrEqual(116);
    expect(layout.searchTop).toBeLessThan(layout.scheduleTop);
    expect(layout.scheduleTop).toBeLessThan(layout.performersTop);
    expect(layout.scheduleRadius).not.toBe("0px");
    expect(layout.performersTop).toBeLessThan(520);
  });
});
