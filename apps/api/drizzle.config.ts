import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` diffs src/db/schema.ts against drizzle/ and writes a new SQL migration.
// No database connection is needed to generate; `dbCredentials` is only read by `drizzle-kit migrate/push`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://hapiecoin:hapiecoin@localhost:5432/hapiecoin",
  },
  strict: true,
  verbose: false,
});
