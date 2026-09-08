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

    // Search rides in the fixed nav rail, so it stays reachable on every page…
    await expect(heroSearch(page)).toBeVisible();
    await expect(page.locator(".yb-nav")).toHaveCSS("position", "fixed");
    await expect(page.locator(".yb-nav-search-inline").locator("input.yb-search")).toBeVisible();
    // …and the wordmark appears once, not again beside the field.
    await expect(page.locator(".yb-brand")).toHaveCount(1);
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
      "Peyton Manning had 5,477 passing yards in 2013.",
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
    // Context, not methodology: where this number sits in the league.
    const context = answer.locator(".yb-single-context");
    await expect(context).toContainText("Context");
    await expect(context).toContainText(/in the NFL for Passing yards in 2013/i);
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
    for (const heading of ["Drake Maye", "Metric", "Tom Brady"]) {
      await expect(comparison.getByRole("columnheader", { name: heading })).toBeVisible();
    }
    // The winner is called out per row and summarised in prose.
    await expect(comparison.locator(".yb-edge-pill").first()).toBeVisible();
    await expect(comparison.locator(".yb-comparison-summary")).not.toBeEmpty();
    await expect(comparison).toContainText("23 seasons · NE, TB");
    await expect(comparison).toContainText("Interception rate");
    await expect(comparison).toContainText("Passing yards per game");
    await expect(comparison).not.toContainText("Fantasy points");
    await expect(comparison).not.toContainText("Receiving yards");
    await expect(comparison).not.toContainText("Tackles");

    await page.getByRole("button", { name: /^First \d+ games$/ }).click();
    await expect(comparison).toContainText(/same \d+ games|first \d+ games/i);
    await page.getByRole("button", { name: "Career totals" }).click();
    await expect(comparison).toContainText(/substantially longer career/i);

    await expect(comparison.getByRole("link", { name: "View Drake Maye profile" })).toBeVisible();
    await expect(comparison.getByRole("link", { name: "View Tom Brady profile" })).toBeVisible();
    await expect(comparison.getByRole("button", { name: "Compare game logs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();

    // Both identities render at the same avatar size, headshot or initials.
    const headshots = comparison.locator(".yb-comparison-identity .yb-avatar");
    await expect(headshots).toHaveCount(2);
    const geometry = await headshots.first().evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      radius: getComputedStyle(node).borderRadius,
    }));
    expect(geometry).toEqual({ width: 72, height: 72, radius: "50%" });
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
    await expect(page.locator(".yb-answer")).not.toBeEmpty();
    await expect(page.getByRole("link", { name: "New search" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
    // The executed SQL and the audit verdict never cross the wire.
    await expect(page.getByText("Query interpretation")).toHaveCount(0);
    await page.getByRole("link", { name: "New search" }).click();
    await heroSearch(page).click();
    await expect(page.locator(".yb-suggest-item.question").first()).toContainText(question);
  });

  test("nested examples run a query and return as the first recent suggestion", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).click();
    // The list starts on built-in examples and swaps to the question bank when
    // it loads, so read the label first and then click *that* item by name —
    // clicking by position can hit whatever moved into the row.
    const question = await page
      .locator(".yb-suggest-item.question")
      .first()
      .locator(".nm")
      .textContent();
    await page
      .locator(".yb-suggest-item.question")
      .filter({ hasText: question! })
      .first()
      .click();

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-result-canvas")).toBeVisible();
    await page.getByRole("link", { name: "New search" }).click();
    await heroSearch(page).click();
    await expect(page.locator(".yb-suggest-item.question").first()).toContainText(question!);
  });

  test("compact search nests question-bank suggestions and accepts a selection", async ({
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
    // Nothing runs until a suggestion is chosen…
    await expect(page.locator(".yb-answer")).toHaveCount(0);
    await completion.click();
    // …and choosing one fills the field and runs it.
    await expect(search).toHaveValue("Most rushing yards in a season");
    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-answer")).toBeVisible();
  });

  test("completed results have a persistent dedicated page and a shareable link", async ({
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
    // The result page is the result, not the dashboard with an answer on top.
    await expect(page.getByRole("heading", { name: "Performers of the week" })).toHaveCount(0);

    // Durable: the answer is persisted, so the URL survives a reload.
    await page.reload();
    await expect(page).toHaveURL(resultUrl);
    await expect(page.locator(".yb-answer")).toBeVisible();

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(resultUrl);
  });

  test("tied playoff leaders each get a leader card above the ranked table", async ({
    page,
  }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who threw the most touchdowns in the playoffs in 2024?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    await expect(page.locator(".yb-answer")).toContainText(/are tied.*5 passing touchdowns/i);

    // A tie promotes every tied player to a card of their own, each linking out.
    const leaders = page.locator(".yb-result-leader-card");
    await expect(leaders).toHaveCount(3);
    await expect(page.getByRole("region", { name: "Tied leaders" })).toBeVisible();
    await expect(leaders.getByRole("link", { name: "View profile" })).toHaveCount(3);
    for (const card of await leaders.all()) {
      await expect(card).toContainText("5 passing touchdowns");
    }

    // …and the full board still sits underneath, one page of ten.
    const ranked = page.locator(".yb-result-ranked-table");
    await expect(ranked).toBeVisible();
    await expect(ranked.locator("tbody tr")).toHaveCount(10);

    // Drilling into a leader lands on their player page, not an embedded bio.
    await expect(page.getByText("Height", { exact: true })).toHaveCount(0);
    await expect(page.getByText("College", { exact: true })).toHaveCount(0);
    await leaders.first().getByRole("link", { name: "View profile" }).click();
    await expect(page).toHaveURL(/\/players\/.+/);
  });

  test("leader boards carry only the queried metric's family", async ({ page }) => {
    await page.goto("/");
    await heroSearch(page).fill("Who rushed for the most yards in 2024?");
    await heroSearch(page).press("Enter");

    await expect(page).toHaveURL(/\/a\/[a-f0-9]{32}$/);
    const ranked = page.locator(".yb-result-ranked-table");
    await expect(ranked).toBeVisible();
    // The board answers the rushing question and nothing else — no passing
    // column tags along, and the queried metric is the highlighted one.
    await expect(ranked.getByRole("columnheader", { name: "player" })).toBeVisible();
    await expect(ranked.locator("th.is-metric")).toHaveCount(1);
    await expect(ranked.getByRole("columnheader", { name: /passing/i })).toHaveCount(0);
    await expect(ranked.getByRole("columnheader", { name: "player id" })).toHaveCount(0);
    // Real 2024 rushing leader, linked to his page.
    const top = ranked.locator("tbody tr").first();
    await expect(top).toContainText("Saquon Barkley");
    await expect(top.getByRole("link").first()).toHaveAttribute("href", /\/players\//);
  });

  test("sports data leads the home page instead of a giant search hero", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Performers of the week" })).toBeVisible();
    await expect(page.locator(".yb-search-icon")).toBeVisible();
    // No search hero: the field is a compact rail control and the scores
    // ticker is the first thing in the content column.
    const layout = await page.evaluate(() => {
      const search = document.querySelector<HTMLElement>(".yb-nav-search-inline")!;
      const schedule = document.querySelector<HTMLElement>(".yb-ticker")!;
      const performers = document.querySelector<HTMLElement>(
        '[aria-label="Performers of the Week"]',
      )!;
      return {
        searchHeight: search.getBoundingClientRect().height,
        scheduleTop: schedule.getBoundingClientRect().top,
        scheduleRadius: getComputedStyle(schedule).borderRadius,
        performersTop: performers.getBoundingClientRect().top,
      };
    });
    expect(layout.searchHeight).toBeLessThanOrEqual(116);
    expect(layout.scheduleTop).toBeLessThan(layout.performersTop);
    expect(layout.scheduleRadius).not.toBe("0px");
    expect(layout.performersTop).toBeLessThan(520);
  });
});
