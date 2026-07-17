/** Small, static, well-known NFL facts that no nflverse file carries:
 * marquee award winners, franchise founding years, and relocations/renames.
 * Curated and checked in. Only facts with unambiguous public records belong
 * here; anything uncertain stays a refusal rather than a guess. */

/** AP MVP and Super Bowl MVP by SEASON (the SB is played the next February). */
export const AWARDS: { season: number; award: "MVP" | "SBMVP"; player: string }[] = [
  { season: 1999, award: "MVP", player: "Kurt Warner" },
  { season: 2000, award: "MVP", player: "Marshall Faulk" },
  { season: 2001, award: "MVP", player: "Kurt Warner" },
  { season: 2002, award: "MVP", player: "Rich Gannon" },
  { season: 2003, award: "MVP", player: "Peyton Manning & Steve McNair (co-MVPs)" },
  { season: 2004, award: "MVP", player: "Peyton Manning" },
  { season: 2005, award: "MVP", player: "Shaun Alexander" },
  { season: 2006, award: "MVP", player: "LaDainian Tomlinson" },
  { season: 2007, award: "MVP", player: "Tom Brady" },
  { season: 2008, award: "MVP", player: "Peyton Manning" },
  { season: 2009, award: "MVP", player: "Peyton Manning" },
  { season: 2010, award: "MVP", player: "Tom Brady" },
  { season: 2011, award: "MVP", player: "Aaron Rodgers" },
  { season: 2012, award: "MVP", player: "Adrian Peterson" },
  { season: 2013, award: "MVP", player: "Peyton Manning" },
  { season: 2014, award: "MVP", player: "Aaron Rodgers" },
  { season: 2015, award: "MVP", player: "Cam Newton" },
  { season: 2016, award: "MVP", player: "Matt Ryan" },
  { season: 2017, award: "MVP", player: "Tom Brady" },
  { season: 2018, award: "MVP", player: "Patrick Mahomes" },
  { season: 2019, award: "MVP", player: "Lamar Jackson" },
  { season: 2020, award: "MVP", player: "Aaron Rodgers" },
  { season: 2021, award: "MVP", player: "Aaron Rodgers" },
  { season: 2022, award: "MVP", player: "Patrick Mahomes" },
  { season: 2023, award: "MVP", player: "Lamar Jackson" },
  { season: 2024, award: "MVP", player: "Josh Allen" },
  { season: 1999, award: "SBMVP", player: "Kurt Warner" },
  { season: 2000, award: "SBMVP", player: "Ray Lewis" },
  { season: 2001, award: "SBMVP", player: "Tom Brady" },
  { season: 2002, award: "SBMVP", player: "Dexter Jackson" },
  { season: 2003, award: "SBMVP", player: "Tom Brady" },
  { season: 2004, award: "SBMVP", player: "Deion Branch" },
  { season: 2005, award: "SBMVP", player: "Hines Ward" },
  { season: 2006, award: "SBMVP", player: "Peyton Manning" },
  { season: 2007, award: "SBMVP", player: "Eli Manning" },
  { season: 2008, award: "SBMVP", player: "Santonio Holmes" },
  { season: 2009, award: "SBMVP", player: "Drew Brees" },
  { season: 2010, award: "SBMVP", player: "Aaron Rodgers" },
  { season: 2011, award: "SBMVP", player: "Eli Manning" },
  { season: 2012, award: "SBMVP", player: "Joe Flacco" },
  { season: 2013, award: "SBMVP", player: "Malcolm Smith" },
  { season: 2014, award: "SBMVP", player: "Tom Brady" },
  { season: 2015, award: "SBMVP", player: "Von Miller" },
  { season: 2016, award: "SBMVP", player: "Tom Brady" },
  { season: 2017, award: "SBMVP", player: "Nick Foles" },
  { season: 2018, award: "SBMVP", player: "Julian Edelman" },
  { season: 2019, award: "SBMVP", player: "Patrick Mahomes" },
  { season: 2020, award: "SBMVP", player: "Tom Brady" },
  { season: 2021, award: "SBMVP", player: "Cooper Kupp" },
  { season: 2022, award: "SBMVP", player: "Patrick Mahomes" },
  { season: 2023, award: "SBMVP", player: "Patrick Mahomes" },
  { season: 2024, award: "SBMVP", player: "Jalen Hurts" },
];

/** Franchise founding years (year of first play, commonly cited). */
export const TEAM_FOUNDED: Record<string, number> = {
  ARI: 1920, ATL: 1966, BAL: 1996, BUF: 1960, CAR: 1995, CHI: 1920,
  CIN: 1968, CLE: 1946, DAL: 1960, DEN: 1960, DET: 1930, GB: 1921,
  HOU: 2002, IND: 1953, JAX: 1995, KC: 1960, LAC: 1960, LAR: 1937,
  LV: 1960, MIA: 1966, MIN: 1961, NE: 1960, NO: 1967, NYG: 1925,
  NYJ: 1960, PHI: 1933, PIT: 1933, SEA: 1976, SF: 1946, TB: 1976,
  TEN: 1960, WAS: 1932,
};

/** Relocations and renames within the warehouse's modern era. */
export const TEAM_HISTORY: Record<string, string> = {
  LV: "The Raiders relocated from Oakland to Las Vegas in 2020 (and played in Los Angeles 1982–1994).",
  LAC: "The Chargers relocated from San Diego to Los Angeles in 2017.",
  LAR: "The Rams returned from St. Louis to Los Angeles in 2016 (St. Louis 1995–2015).",
  TEN: "The franchise moved from Houston (Oilers) to Tennessee in 1997 and became the Titans in 1999.",
  IND: "The Colts relocated from Baltimore to Indianapolis in 1984.",
  ARI: "The Cardinals moved from St. Louis to Arizona in 1988 (Phoenix Cardinals until 1994).",
  WAS: "Washington retired the former name in 2020, played as the Football Team, and became the Commanders in 2022.",
};
