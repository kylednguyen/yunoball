import { expect, test } from "@playwright/test";

test.describe("explore", () => {
  test("team list drills into a season-aware team page and out to a player", async ({ page }) => {
    await page.goto("/teams?season=2023");
    await page.getByRole("link", { name: /49ers/ }).click();

    await expect(page).toHaveURL(/\/teams\/SF\?season=2023/);
    await expect(page.getByRole("heading", { name: "San Francisco 49ers" })).toBeVisible();
    // Real 2023: 12-5, NFC West champs.
    await expect(page.locator(".yb-page-sub")).toContainText("12-5");
    await expect(page.getByText("Team leaders")).toBeVisible();

    // Leaders card → player page, carrying the season along.
    await page.locator(".yb-leader-card").first().click();
    await expect(page).toHaveURL(/\/players\/.+season=2023/);
  });

  test("season switch updates the team page in place", async ({ page }) => {
    await page.goto("/teams/SF?season=2023");
    await expect(page.locator(".yb-page-sub")).toContainText("12-5");

    await page.getByRole("button", { name: "Select season" }).click();
    await page.getByRole("option", { name: "2024 season" }).click();
    await expect(page).toHaveURL(/season=2024/);
    // Real 2024: the 49ers fell to 6-11.
    await expect(page.locator(".yb-page-sub")).toContainText("6-11");
  });

  test("standings rows link to team pages with the season preserved", async ({ page }) => {
    await page.goto("/standings?season=2023");
    await page.getByRole("link", { name: /Buffalo Bills/ }).click();

    await expect(page).toHaveURL(/\/teams\/BUF\?season=2023/);
    await expect(page.locator(".yb-page-sub")).toContainText("11-6");
  });

  test("leaders hub filters by position and exposes team rankings", async ({ page }) => {
    await page.goto("/leaders?season=2023");
    await expect(page.getByRole("heading", { name: "League Leaders" })).toBeVisible();

    await page.getByRole("button", { name: "Select leaderboard category" }).click();
    await page.getByRole("option", { name: "Rushing Yards" }).click();
    await page.getByRole("button", { name: "Filter by position" }).click();
    await page.getByRole("option", { name: "RB" }).click();
    // Player boards render as ranked link cards; the #1 card is .yb-board-top.
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

  test("fantasy page labels production honestly and exposes explicit optimizer", async ({ page }) => {
    await page.goto("/fantasy?season=2023");

    await expect(page.getByText("Actual PPR per game")).toBeVisible();
    await expect(page.getByText("Season PPR points")).toBeVisible();
    await expect(page.getByRole("button", { name: "Optimize by PPR average" })).toBeVisible();
    await expect(page.getByLabel("Scoring format")).toHaveText(/PPR/);
  });

  test("player page filters the game log by season", async ({ page }) => {
    await page.goto("/players/00-0033873?season=2023"); // Mahomes
    await expect(page.getByRole("heading", { name: "Patrick Mahomes" })).toBeVisible();
    // Header carries the most-recent-season PPR position rank (QB #N of M).
    await expect(page.locator(".yb-page-sub").first()).toContainText(/QB #\d+ of \d+/);

    // The season-filterable game log lives in its own tab.
    await page.getByRole("tab", { name: "Game Log" }).click();
    const logRows = page.locator(".yb-table tbody tr");

    // One season → a bounded set of rows.
    await page.getByRole("button", { name: "Filter game log by season" }).click();
    await page.getByRole("option", { name: "2023 season" }).click();
    await expect.poll(() => logRows.count()).toBeLessThan(30);
    const oneSeason = await logRows.count();
    expect(oneSeason).toBeGreaterThan(0);

    // Widen to all seasons → strictly more rows.
    await page.getByRole("button", { name: "Filter game log by season" }).click();
    await page.getByRole("option", { name: "All seasons" }).click();
    await expect.poll(() => logRows.count()).toBeGreaterThan(oneSeason);
  });
});
