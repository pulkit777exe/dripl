import { Router } from "express";
import { RoomController } from "../controllers/roomController";
import { authMiddleware } from "../middlewares/authMiddleware";

const router: Router = Router();

router.use(authMiddleware);

router.get("/", RoomController.getRooms);
router.post("/", RoomController.createRoom);
router.get("/:slug", RoomController.getRoom);
router.put("/:slug", RoomController.updateRoom);
router.delete("/:slug", RoomController.deleteRoom);

// management
router.post("/:slug/members", RoomController.addMember);
router.delete("/:slug/members/:userId", RoomController.removeMember);

export default router;
