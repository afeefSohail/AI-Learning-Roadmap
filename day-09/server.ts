import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { error } from "./chat.error" 
import chatRouters from "./chat.routes" 


const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));
app.use(chatRouters)
app.use(error);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`chat API on http://localhost:${PORT}`));