import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stickersRouter from "./stickers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stickersRouter);

export default router;
