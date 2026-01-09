import { Router } from "express";
import { TeamController } from "../controllers/teamController";

const teamRouter: Router = Router();

teamRouter.post("/", TeamController.createTeam);
teamRouter.get("/", TeamController.getTeams);
teamRouter.get("/:teamId", TeamController.getTeamById);

export { teamRouter };