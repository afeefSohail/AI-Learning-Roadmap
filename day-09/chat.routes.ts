import express, { Router } from "express";
import { requireAuth } from "./auth";
import { chat, conversation, converstations } from "./chat.controllers";

const router: Router = express.Router();

router.post("/chat", requireAuth, chat);
router.get("/conversations", requireAuth,  converstations);
router.get("/conversations/:id", requireAuth, conversation);
export default router;
