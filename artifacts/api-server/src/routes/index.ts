import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stickersRouter from "./stickers";
import sharesRouter from "./shares";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stickersRouter);
router.use(sharesRouter);

export default router;
