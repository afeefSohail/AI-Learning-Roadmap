import type {
  NextFunction,
  Request,
  Response,
} from "express";

export const error = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "bad_request", message: "The request could not be read." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
};
