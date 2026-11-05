import "dotenv/config";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

const accessSecretKey = process.env.JWT_ACCESS_SECRET;
if (!accessSecretKey) throw new Error("JWT_ACCESS_SECRET is not set");
const SECRET: string = accessSecretKey;
const ALGORITHM = (process.env.JWT_ALGORITHM ?? "HS256") as jwt.Algorithm;
const USER_ID_CLAIM = process.env.JWT_USER_ID_CLAIM ?? "sub";

// Verifies the same access token UserAuth issues. No call to the UserAuth backend.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Missing bearer token." });
    return;
  }

  try {
    // Pin the algorithm. Never trust the one named in the token's header.
    const payload = jwt.verify(header.slice(7), SECRET, { algorithms: [ALGORITHM] });
    if (typeof payload === "string") throw new Error("unexpected token payload");

    // If UserAuth marks refresh tokens (a "type" claim, say), reject those here too.
    const id = payload[USER_ID_CLAIM];
    if (id === undefined || id === null || id === "") {
      console.error(`token has no "${USER_ID_CLAIM}" claim. Claims present:`, Object.keys(payload));
      res.status(401).json({ error: "unauthorized", message: "Invalid token." });
      return;
    }

    res.locals.userId = String(id); // from the verified token, never from the request body
    next();
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token." });
  }
}
