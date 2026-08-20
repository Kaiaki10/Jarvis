import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs before each test file's own module imports, so importing the repo
    // layer can never open the live jarvis.db. See vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    // Parallel file execution creates race conditions when multiple test files
    // simultaneously import db.ts, which opens a SQLite database and runs
    // migrations at module load time. Sequential execution prevents timeouts.
    fileParallelism: false,
  },
});
