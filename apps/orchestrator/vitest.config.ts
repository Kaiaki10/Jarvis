import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs before each test file's own module imports, so importing the repo
    // layer can never open the live jarvis.db. See vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
  },
});
