import { expect, test } from "@playwright/test";

const heroSearch = (page: import("@playwright/test").Page) =>
  page.getByRole("combobox", { name: "Search NFL stats, players, and teams" });

test.describe("search", () => {
  test("question returns an answer card with linked player rows", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who threw the most touchdowns in 2023?");
    await heroSearch(page).press("Enter");

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
    await page.getByRole("option", { name: /Patrick Mahomes/ }).click();

    await expect(page).toHaveURL(/\/players\/00-0033873/);
    await expect(page.getByRole("heading", { name: "Patrick Mahomes" })).toBeVisible();
  });

  test("inner-page sidebar keeps search focused on the primary Search page", async ({ page }) => {
    await page.goto("/standings");

    await expect(heroSearch(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Search" }).click();
    await expect(heroSearch(page)).toBeVisible();
  });

  test("player comparison renders a head-to-head table on real stats", async ({ page }) => {
    await page.goto(
      `/?q=${encodeURIComponent("josh allen post season first 5 games versus drake maye first 5")}`,
    );

    await expect(page.locator(".yb-answer")).toContainText(
      "first 5 postseason games, Josh Allen leads Drake Maye in passing yards",
    );
    const compare = page.locator(".yb-compare");
    await expect(compare).toBeVisible();
    await expect(compare).toContainText("Josh Allen");
    await expect(compare).toContainText("Drake Maye");
    await expect(compare).toContainText("Pass yds");
    await expect(compare).not.toContainText("Fantasy"); // actual stats only
    await expect(compare.locator(".lead").first()).toBeVisible();
  });

  test("home search leads with supported sample queries and structured result actions", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Try a supported query")).toBeVisible();
    const sample = page.locator(".yb-sample-query").first();
    const question = await sample.textContent();
    await sample.click();

    await expect(page.locator(".yb-query-result")).toBeVisible();
    await expect(page.getByText("Query interpretation")).toBeVisible();
    await expect(page.getByRole("button", { name: /Show query/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
    await expect(page.getByText("Recent:")).toBeVisible();
    await expect(page.locator(".yb-recent-query", { hasText: question! })).toBeVisible();
  });

  test("example chips run a query and land in recents", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator(".yb-chip").first();
    const question = await chip.textContent();
    await chip.click();

    await expect(page.locator(".yb-answer")).not.toBeEmpty();
    await expect(page.getByText("Recent:")).toBeVisible();
    await expect(page.locator(".yb-chip", { hasText: question! }).last()).toBeVisible();
  });
});
