/** Route table — paths only; behavior lives in controllers/services. */

import { Router } from "express";
import * as c from "../controllers/index.js";

export const routes = Router();

routes.post("/api/search", c.search);
routes.get("/api/search/examples", c.searchExamples);
routes.get("/api/search/suggest", c.searchSuggest);
routes.get("/api/search/answer/:shareId", c.sharedAnswer);

routes.get("/api/leaderboards", c.leaderboards);
routes.get("/api/games", c.games);
routes.get("/api/games/performers", c.performers);
routes.get("/api/games/:gameId/boxscore", c.boxScore);
routes.get("/api/standings", c.standings);
routes.get("/api/fantasy/players", c.fantasyPlayers);
routes.get("/api/players/:playerId", c.playerProfile);
routes.get("/api/players/:playerId/splits", c.playerSplits);
routes.get("/api/teams/:teamId", c.teamProfile);

routes.post("/api/agent", c.agent);
