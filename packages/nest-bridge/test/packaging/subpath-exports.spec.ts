import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Subpath exports compile contract (spec 003, US3; contracts/package-exports.md;
 * research R8): each fixture is type-checked by a real `tsc --noEmit` run whose
 * `paths` resolve `@ycforge/nestjs-connector` subpaths at the BUILT `dist/`
 * declarations — the same files the package.json exports map points at.
 * Requires `pnpm build` first (quickstart scenario 3).
 */

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturesRoot = path.join(packageRoot, "test", "packaging", "fixtures");
const require = createRequire(import.meta.url);
const tscBin = require.resolve("typescript/bin/tsc");

const SUBPATH_DTS: Record<string, string> = {
  "@ycforge/nestjs-connector": "dist/index.d.ts",
  "@ycforge/nestjs-connector/auth": "dist/auth/index.d.ts",
  "@ycforge/nestjs-connector/queue": "dist/queue/index.d.ts",
  "@ycforge/nestjs-connector/context": "dist/context/index.d.ts",
};

function compileFixture(fixtureName: string): void {
  const scratch = mkdtempSync(path.join(tmpdir(), "subpath-exports-"));
  try {
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        baseUrl: ".",
        paths: Object.fromEntries(
          Object.entries(SUBPATH_DTS).map(([specifier, dts]) => [
            specifier,
            [path.join(packageRoot, dts)],
          ]),
        ),
      },
      files: [path.join(fixturesRoot, fixtureName)],
    };
    const tsconfigPath = path.join(scratch, "tsconfig.json");
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig));
    execFileSync(process.execPath, [tscBin, "-p", tsconfigPath], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe("subpath exports compile contract (US3, SC-003)", () => {
  beforeAll(() => {
    const missing = Object.values(SUBPATH_DTS).filter(
      (dts) => !existsSync(path.join(packageRoot, dts)),
    );
    if (missing.length > 0) {
      throw new Error(
        `built declarations missing (${missing.join(", ")}); run \`pnpm build\` first`,
      );
    }
  });

  it("compiles a consumer importing only the /auth subpath (US3/AC1)", () => {
    compileFixture("import-auth.ts");
  });

  it("compiles consumers importing /queue and /context (US3/AC2)", () => {
    compileFixture("import-queue.ts");
    compileFixture("import-context.ts");
  });

  it("keeps the root barrel compilable for existing applications (US3/AC3)", () => {
    compileFixture("import-root.ts");
  });
});
