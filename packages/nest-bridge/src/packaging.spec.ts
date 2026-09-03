import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Publishability pins for the distributable package (spec 003; successor of
 * the v0.0.3 packaging spec): these specs read the package configuration
 * directly so accidental metadata changes that would break consumers — a
 * lost export subpath, a runtime dependency, lost declaration output — fail
 * here before they ever reach npm.
 */

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as Record<
  string,
  unknown
>;
const tsconfigJson = JSON.parse(
  readFileSync(path.join(packageRoot, "tsconfig.json"), "utf8"),
) as Record<string, unknown>;

describe("npm package distribution contract", () => {
  it("is published under the monorepo name and version", () => {
    expect(packageJson.name).toBe("@ycforge/nestjs-connector");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.type).toBe("module");
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.publishConfig).toEqual({ access: "public" });
  });

  it("exposes the contracted subpath exports map (contracts/package-exports.md)", () => {
    expect(packageJson.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        require: "./dist/index.cjs",
      },
      "./auth": {
        types: "./dist/auth/index.d.ts",
        import: "./dist/auth/index.js",
        require: "./dist/auth/index.cjs",
      },
      "./queue": {
        types: "./dist/queue/index.d.ts",
        import: "./dist/queue/index.js",
        require: "./dist/queue/index.cjs",
      },
      "./context": {
        types: "./dist/context/index.d.ts",
        import: "./dist/context/index.js",
        require: "./dist/context/index.cjs",
      },
    });
  });

  it("explicitly targets Node.js 22", () => {
    expect(packageJson.engines).toEqual({ node: ">=22" });
  });

  it("ships only built output", () => {
    expect(packageJson.files).toEqual(["dist"]);
    expect(packageJson.sideEffects).toBe(false);
  });

  it("keeps zero runtime dependencies with NestJS 11 peers only", () => {
    expect(packageJson.dependencies).toBeUndefined();

    expect(packageJson.peerDependencies).toEqual({
      "@nestjs/common": "^11.0.0",
      "@nestjs/core": "^11.0.0",
      "@nestjs/swagger": "^11.0.0",
    });
  });

  it("provides the workspace workflow scripts", () => {
    const scripts = packageJson.scripts as Record<string, string>;

    for (const script of ["build", "typecheck", "test"]) {
      expect(scripts[script]).toBeDefined();
    }
  });
});

describe("library build configuration contract", () => {
  it("type-checks strict ES2022 sources with decorator support", () => {
    const compilerOptions = tsconfigJson.compilerOptions as Record<string, unknown>;

    expect(compilerOptions.target).toBe("ES2022");
    expect(compilerOptions.strict).toBe(true);
    expect(compilerOptions.experimentalDecorators).toBe(true);
    expect(compilerOptions.emitDecoratorMetadata).toBe(true);
  });
});
