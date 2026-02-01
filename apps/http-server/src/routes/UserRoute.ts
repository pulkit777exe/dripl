import { Router } from "express";
import { UserController } from "../controllers/userController";
import { authMiddleware } from "../middlewares/authMiddleware";

const userRouter: Router = Router();

userRouter.post("/signup", UserController.signup);
userRouter.post("/login", UserController.login);

userRouter.post("/logout", authMiddleware, UserController.logout);
userRouter.get("/profile", authMiddleware, UserController.getProfile);
userRouter.put("/profile", authMiddleware, UserController.updateProfile);

export { userRouter };