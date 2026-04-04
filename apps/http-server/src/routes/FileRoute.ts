import { Router } from "express";
import { FileController } from "../controllers/fileController";
import { authMiddleware } from "../middlewares/authMiddleware";

const fileRouter: Router = Router();

fileRouter.use(authMiddleware);

fileRouter.get("/", FileController.getFiles);
fileRouter.post("/", FileController.createFile);
fileRouter.get("/:fileId", FileController.getFile);
fileRouter.put("/:fileId", FileController.updateFile);
fileRouter.delete("/:fileId", FileController.deleteFile);

export { fileRouter };
