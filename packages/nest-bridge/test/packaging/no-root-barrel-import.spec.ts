import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard test for FR-008 (spec 003, research R7): modules under the
 * subpath entries `src/auth`, `src/queue`, `src/context` must never import
 * the root barrel `src/index.ts` — directly or via a path that resolves to
 * it. Runs in the regular `pnpm test`.
 */

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(packageRoot, "src");
const rootBarrel = path.join(srcRoot, "index.ts");
const GUARDED_DIRS = ["auth", "queue", "context"];

const IMPORT_FROM = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g;

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

/** Returns every import specifier in `filePath` that resolves to the root barrel. */
export function findRootBarrelImports(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const offenders: string[] = [];
  for (const match of source.matchAll(IMPORT_FROM)) {
    const specifier = match[1];
    if (specifier === undefined || !specifier.startsWith(".")) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), specifier);
    if (resolved === rootBarrel || resolved === rootBarrel.replace(/\.ts$/, "")) {
      offenders.push(specifier);
    }
  }
  return offenders;
}

describe("FR-008: subpath modules never import the root barrel", () => {
  it("src/auth, src/queue, src/context are clean", () => {
    const violations: string[] = [];
    for (const dir of GUARDED_DIRS) {
      for (const file of listSourceFiles(path.join(srcRoot, dir))) {
        for (const specifier of findRootBarrelImports(file)) {
          violations.push(`${path.relative(packageRoot, file)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("self-check: the scanner catches a deliberately forbidden import", () => {
    const scratch = path.join(srcRoot, "auth", "__fr008_self_check__");
    mkdirSync(scratch, { recursive: true });
    const planted = path.join(scratch, "planted.ts");
    try {
      writeFileSync(planted, 'export { createYandexHandler } from "../../index";\n');
      expect(findRootBarrelImports(planted)).toEqual(["../../index"]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
