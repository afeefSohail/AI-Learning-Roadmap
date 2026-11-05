import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "day-09/prisma/schema.prisma",
  migrations: { path: "day-09/prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});