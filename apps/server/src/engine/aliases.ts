// NFL player alias dictionary for the search engine.
// Keys are pre-normalized via normalizeAlias(). All playerIds are gsis ids verified against the warehouse.
// Deliberately rejected (do NOT re-add): "to" (English stopword), "edge" (position term),
// "ar15" (disavowed by player, brand-unsafe), bare surnames ("bosa", "tank", "mooney", "revis").

/** @public part of the alias data API */
export type PlayerAliasCandidate = {
  playerId: string;
  playerName: string;
  position?: string;
  team?: string;
  activeFrom?: number;
  activeTo?: number;
  confidence: number;
};

export type PlayerAliasMap = Record<string, PlayerAliasCandidate[]>;

/** Single-candidate aliases: safe to auto-resolve. */
export const NFL_PLAYER_ALIASES: PlayerAliasMap = {
  // --- Offense, current era ---
  cmc: [{ playerId: "00-0033280", playerName: "Christian McCaffrey", position: "RB", activeFrom: 2017, activeTo: 2025, confidence: 0.99 }],
  jt: [{ playerId: "00-0036223", playerName: "Jonathan Taylor", position: "RB", activeFrom: 2020, activeTo: 2025, confidence: 0.85 }],
  zeke: [{ playerId: "00-0033045", playerName: "Ezekiel Elliott", position: "RB", activeFrom: 2016, activeTo: 2024, confidence: 0.95 }],
  etn: [{ playerId: "00-0036973", playerName: "Travis Etienne", position: "RB", activeFrom: 2021, activeTo: 2025, confidence: 0.8 }],
  ceh: [{ playerId: "00-0036360", playerName: "Clyde Edwards-Helaire", position: "RB", activeFrom: 2020, activeTo: 2025, confidence: 0.85 }],
  kinghenry: [{ playerId: "00-0032764", playerName: "Derrick Henry", position: "RB", activeFrom: 2016, activeTo: 2025, confidence: 0.7 }],
  kw3: [{ playerId: "00-0038134", playerName: "Kenneth Walker III", position: "RB", activeFrom: 2022, activeTo: 2025, confidence: 0.85 }],
  arsb: [{ playerId: "00-0036963", playerName: "Amon-Ra St. Brown", position: "WR", activeFrom: 2021, activeTo: 2025, confidence: 0.95 }],
  jsn: [{ playerId: "00-0038543", playerName: "Jaxon Smith-Njigba", position: "WR", activeFrom: 2023, activeTo: 2025, confidence: 0.95 }],
  dk: [{ playerId: "00-0035640", playerName: "DK Metcalf", position: "WR", activeFrom: 2019, activeTo: 2025, confidence: 0.85 }],
  cd: [{ playerId: "00-0036358", playerName: "CeeDee Lamb", position: "WR", activeFrom: 2020, activeTo: 2025, confidence: 0.75 }],
  ajb: [{ playerId: "00-0035676", playerName: "A.J. Brown", position: "WR", activeFrom: 2019, activeTo: 2025, confidence: 0.95 }],
  mhj: [{ playerId: "00-0039849", playerName: "Marvin Harrison Jr.", position: "WR", activeFrom: 2024, activeTo: 2025, confidence: 0.95 }],
  jjettas: [{ playerId: "00-0036322", playerName: "Justin Jefferson", position: "WR", activeFrom: 2020, activeTo: 2025, confidence: 0.85 }],
  obj: [{ playerId: "00-0031235", playerName: "Odell Beckham Jr.", position: "WR", activeFrom: 2014, activeTo: 2024, confidence: 0.95 }],
  nuk: [{ playerId: "00-0030564", playerName: "DeAndre Hopkins", position: "WR", activeFrom: 2013, activeTo: 2025, confidence: 0.85 }],
  dhop: [{ playerId: "00-0030564", playerName: "DeAndre Hopkins", position: "WR", activeFrom: 2013, activeTo: 2025, confidence: 0.85 }],
  hollywood: [{ playerId: "00-0035662", playerName: "Marquise Brown", position: "WR", activeFrom: 2019, activeTo: 2025, confidence: 0.7 }],
  scaryterry: [{ playerId: "00-0035659", playerName: "Terry McLaurin", position: "WR", activeFrom: 2019, activeTo: 2025, confidence: 0.75 }],
  mvs: [{ playerId: "00-0034272", playerName: "Marquez Valdes-Scantling", position: "WR", activeFrom: 2018, activeTo: 2025, confidence: 0.85 }],
  btj: [{ playerId: "00-0039893", playerName: "Brian Thomas Jr.", position: "WR", activeFrom: 2024, activeTo: 2025, confidence: 0.7 }],
  jamo: [{ playerId: "00-0037240", playerName: "Jameson Williams", position: "WR", activeFrom: 2022, activeTo: 2025, confidence: 0.8 }],
  gronk: [{ playerId: "00-0027656", playerName: "Rob Gronkowski", position: "TE", activeFrom: 2010, activeTo: 2021, confidence: 0.9 }],
  tlaw: [{ playerId: "00-0036971", playerName: "Trevor Lawrence", position: "QB", activeFrom: 2021, activeTo: 2025, confidence: 0.9 }],
  arod: [{ playerId: "00-0023459", playerName: "Aaron Rodgers", position: "QB", activeFrom: 2005, activeTo: 2025, confidence: 0.9 }],
  tb12: [{ playerId: "00-0019596", playerName: "Tom Brady", position: "QB", activeFrom: 2000, activeTo: 2022, confidence: 0.95 }],
  jimmyg: [{ playerId: "00-0031345", playerName: "Jimmy Garoppolo", position: "QB", activeFrom: 2014, activeTo: 2025, confidence: 0.85 }],
  dannydimes: [{ playerId: "00-0035710", playerName: "Daniel Jones", position: "QB", activeFrom: 2019, activeTo: 2025, confidence: 0.8 }],

  // --- Offense, historical ---
  megatron: [{ playerId: "00-0025389", playerName: "Calvin Johnson", position: "WR", activeFrom: 2007, activeTo: 2015, confidence: 0.97 }],
  ap: [{ playerId: "00-0025394", playerName: "Adrian Peterson", position: "RB", activeFrom: 2007, activeTo: 2021, confidence: 0.85 }],
  allday: [{ playerId: "00-0025394", playerName: "Adrian Peterson", position: "RB", activeFrom: 2007, activeTo: 2021, confidence: 0.7 }],
  purplejesus: [{ playerId: "00-0025394", playerName: "Adrian Peterson", position: "RB", activeFrom: 2007, activeTo: 2021, confidence: 0.75 }],
  lt: [{ playerId: "00-0020536", playerName: "LaDainian Tomlinson", position: "RB", activeFrom: 2001, activeTo: 2011, confidence: 0.9 }],
  shady: [{ playerId: "00-0027029", playerName: "LeSean McCoy", position: "RB", activeFrom: 2009, activeTo: 2020, confidence: 0.85 }],
  ab: [{ playerId: "00-0027793", playerName: "Antonio Brown", position: "WR", activeFrom: 2010, activeTo: 2021, confidence: 0.85 }],
  fitzmagic: [{ playerId: "00-0023682", playerName: "Ryan Fitzpatrick", position: "QB", activeFrom: 2005, activeTo: 2021, confidence: 0.9 }],
  beastmode: [{ playerId: "00-0025399", playerName: "Marshawn Lynch", position: "RB", activeFrom: 2007, activeTo: 2020, confidence: 0.9 }],
  primetime: [{ playerId: "00-0014324", playerName: "Deion Sanders", position: "CB", activeFrom: 1999, activeTo: 2005, confidence: 0.8 }],
  cj2k: [{ playerId: "00-0026164", playerName: "Chris Johnson", position: "RB", activeFrom: 2008, activeTo: 2017, confidence: 0.9 }],
  mjd: [{ playerId: "00-0024275", playerName: "Maurice Jones-Drew", position: "RB", activeFrom: 2006, activeTo: 2014, confidence: 0.9 }],
  sjax: [{ playerId: "00-0022736", playerName: "Steven Jackson", position: "RB", activeFrom: 2004, activeTo: 2015, confidence: 0.75 }],
  thebus: [{ playerId: "00-0001215", playerName: "Jerome Bettis", position: "RB", activeFrom: 1999, activeTo: 2005, confidence: 0.7 }],
  cadillac: [{ playerId: "00-0023440", playerName: "Carnell Williams", position: "RB", activeFrom: 2005, activeTo: 2011, confidence: 0.85 }],
  ochocinco: [{ playerId: "00-0020397", playerName: "Chad Johnson", position: "WR", activeFrom: 2001, activeTo: 2011, confidence: 0.9 }],
  ocho: [{ playerId: "00-0020397", playerName: "Chad Johnson", position: "WR", activeFrom: 2001, activeTo: 2011, confidence: 0.7 }],
  rg3: [{ playerId: "00-0029665", playerName: "Robert Griffin", position: "QB", activeFrom: 2012, activeTo: 2020, confidence: 0.95 }],
  rgiii: [{ playerId: "00-0029665", playerName: "Robert Griffin", position: "QB", activeFrom: 2012, activeTo: 2020, confidence: 0.7 }],
  kaep: [{ playerId: "00-0027974", playerName: "Colin Kaepernick", position: "QB", activeFrom: 2011, activeTo: 2016, confidence: 0.8 }],
  johnnyfootball: [{ playerId: "00-0031409", playerName: "Johnny Manziel", position: "QB", activeFrom: 2014, activeTo: 2016, confidence: 0.7 }],
  bigben: [{ playerId: "00-0022924", playerName: "Ben Roethlisberger", position: "QB", activeFrom: 2004, activeTo: 2021, confidence: 0.85 }],
  mattyice: [{ playerId: "00-0026143", playerName: "Matt Ryan", position: "QB", activeFrom: 2008, activeTo: 2024, confidence: 0.7 }],
  vjax: [{ playerId: "00-0023496", playerName: "Vincent Jackson", position: "WR", activeFrom: 2005, activeTo: 2016, confidence: 0.7 }],
  djax: [{ playerId: "00-0026189", playerName: "DeSean Jackson", position: "WR", activeFrom: 2008, activeTo: 2022, confidence: 0.8 }],

  // --- Defense ---
  jjwatt: [{ playerId: "00-0027949", playerName: "J.J. Watt", position: "DL", activeFrom: 2011, activeTo: 2022, confidence: 0.9 }],
  tjwatt: [{ playerId: "00-0033886", playerName: "T.J. Watt", position: "LB", activeFrom: 2017, activeTo: 2025, confidence: 0.9 }],
  ps2: [{ playerId: "00-0036874", playerName: "Pat Surtain II", position: "DB", activeFrom: 2021, activeTo: 2025, confidence: 0.8 }],
  sauce: [{ playerId: "00-0037190", playerName: "Sauce Gardner", position: "DB", activeFrom: 2022, activeTo: 2025, confidence: 0.85 }],
  ahmadgardner: [{ playerId: "00-0037190", playerName: "Sauce Gardner", position: "DB", activeFrom: 2022, activeTo: 2025, confidence: 0.7 }],
  honeybadger: [{ playerId: "00-0030459", playerName: "Tyrann Mathieu", position: "DB", activeFrom: 2013, activeTo: 2025, confidence: 0.85 }],
  jpp: [{ playerId: "00-0027867", playerName: "Jason Pierre-Paul", position: "DL", activeFrom: 2010, activeTo: 2025, confidence: 0.85 }],
  pacman: [{ playerId: "00-0023441", playerName: "Adam Jones", position: "DB", activeFrom: 2005, activeTo: 2018, confidence: 0.75 }],
  pacmanjones: [{ playerId: "00-0023441", playerName: "Adam Jones", position: "DB", activeFrom: 2005, activeTo: 2018, confidence: 0.8 }],
  lve: [{ playerId: "00-0034674", playerName: "Leighton Vander Esch", position: "LB", activeFrom: 2018, activeTo: 2023, confidence: 0.7 }],
  peanuttillman: [{ playerId: "00-0022123", playerName: "Charles Tillman", position: "DB", activeFrom: 2003, activeTo: 2016, confidence: 0.7 }],
  camjordan: [{ playerId: "00-0027962", playerName: "Cameron Jordan", position: "DL", activeFrom: 2011, activeTo: 2025, confidence: 0.7 }],
  camheyward: [{ playerId: "00-0027969", playerName: "Cameron Heyward", position: "DL", activeFrom: 2011, activeTo: 2025, confidence: 0.7 }],
  dariusleonard: [{ playerId: "00-0034846", playerName: "Shaquille Leonard", position: "LB", activeFrom: 2018, activeTo: 2023, confidence: 0.7 }],
  justinmadubuike: [{ playerId: "00-0036130", playerName: "Nnamdi Madubuike", position: "DL", activeFrom: 2020, activeTo: 2025, confidence: 0.7 }],
};

/** Multi-candidate aliases: never auto-resolve; surface disambiguation to the caller. */
/** @public ambiguity metadata for the clarification flow — never auto-resolved */
export const AMBIGUOUS_ALIASES: PlayerAliasMap = {
  jj: [
    { playerId: "00-0036322", playerName: "Justin Jefferson", position: "WR", activeFrom: 2020, activeTo: 2025, confidence: 0.7 },
    { playerId: "00-0027949", playerName: "J.J. Watt", position: "DL", activeFrom: 2011, activeTo: 2022, confidence: 0.35 },
  ],
  ad: [
    { playerId: "00-0031388", playerName: "Aaron Donald", position: "DL", activeFrom: 2014, activeTo: 2024, confidence: 0.7 },
    { playerId: "00-0025394", playerName: "Adrian Peterson", position: "RB", activeFrom: 2007, activeTo: 2021, confidence: 0.35 },
  ],
  fitz: [
    { playerId: "00-0022921", playerName: "Larry Fitzgerald", position: "WR", activeFrom: 2004, activeTo: 2020, confidence: 0.55 },
    { playerId: "00-0023682", playerName: "Ryan Fitzpatrick", position: "QB", activeFrom: 2005, activeTo: 2021, confidence: 0.35 },
  ],
};

/** Lowercase, fold accents (NFKD), strip everything except a-z and digits. */
/** @public */
export function normalizeAlias(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
