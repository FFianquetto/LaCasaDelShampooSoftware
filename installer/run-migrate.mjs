import { spawnSync } from "node:child_process";
import path from "node:path";

const result = spawnSync(
  "npx",
  ["tsx", "apps/server/src/cli/migrate.ts"],
  {
    cwd: path.resolve("."),
    shell: true,
    encoding: "utf8",
  },
);
console.log(result.stdout || "");
console.error(result.stderr || "");
process.exit(result.status ?? 1);
