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

    await page.getByRole("combobox", { name: "Select season" }).selectOption("2024");
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

    await page.getByRole("tab", { name: "Rushing Yards" }).click();
    await page.getByRole("combobox", { name: "Filter by position" }).selectOption("RB");
    await expect(page.locator("tbody tr").first()).toContainText("Christian McCaffrey");

    await page.getByRole("tab", { name: "Team rankings" }).click();
    const firstTeam = page.locator("tbody tr").first();
    await expect(firstTeam).toContainText("Baltimore Ravens"); // best 2023 record by pct/diff
    await firstTeam.getByRole("link").click();
    await expect(page).toHaveURL(/\/teams\/BAL/);
  });

  test("player page filters the game log by season", async ({ page }) => {
    await page.goto("/players/00-0033873?season=2022"); // Mahomes
    await expect(page.getByRole("heading", { name: "Patrick Mahomes" })).toBeVisible();
    // Position rank pulled from the URL season.
    await expect(page.locator(".yb-page-sub")).toContainText("QB #1 of");

    const logRows = page.locator("table").nth(1).locator("tbody tr");
    const count = await logRows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(30); // one season, not the whole career

    await page.getByRole("combobox", { name: "Filter game log by season" }).selectOption("all");
    expect(await logRows.count()).toBeGreaterThan(count);
  });
});
