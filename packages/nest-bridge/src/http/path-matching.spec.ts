import { ConnectorError } from "../core/connector-error";
import { compilePathPattern } from "./path-matching";

/**
 * Unit specs for the connector's segment matcher (issue #6): the explicit
 * compatibility contract between what NestJS 11 hands to
 * AbstractHttpAdapter (plain strings composed from decorators, controller
 * prefixes and Nest's own middleware path extraction — verified against
 * @nestjs/core 11 sources) and what this connector matches deterministically.
 * Unsupported syntax must fail at registration with ConnectorError code
 * UNSUPPORTED_ROUTE_PATTERN instead of silently misrouting.
 */
describe("compilePathPattern", () => {
  describe("static paths", () => {
    it("matches exact static paths", () => {
      const pattern = compilePathPattern("/health/live");
      expect(pattern.match("/health/live").matched).toBe(true);
    });

    it("ignores trailing slashes on both pattern and request path", () => {
      const pattern = compilePathPattern("/health/");
      expect(pattern.match("/health/").matched).toBe(true);
      expect(pattern.match("/health").matched).toBe(true);
    });

    it("compares case-insensitively like the platform default router", () => {
      const pattern = compilePathPattern("/Cats/List");
      expect(pattern.match("/cats/list").matched).toBe(true);
    });
  });

  describe(":param segments", () => {
    it("captures a single named segment per parameter", () => {
      const pattern = compilePathPattern("/users/:userId");
      const match = pattern.match("/users/42");
      expect(match.matched).toBe(true);
      expect(match.params).toEqual({ userId: "42" });
    });

    it("captures multiple parameters in order", () => {
      const pattern = compilePathPattern("/orgs/:orgId/repos/:repoId");
      const match = pattern.match("/orgs/acme/repos/widgets");
      expect(match.params).toEqual({ orgId: "acme", repoId: "widgets" });
    });

    it("does not let one :param span multiple segments", () => {
      const pattern = compilePathPattern("/files/:name");
      expect(pattern.match("/files/a/b").matched).toBe(false);
    });

    it("rejects optional and regex parameter syntax as UNSUPPORTED_ROUTE_PATTERN", () => {
      for (const pattern of ["/files/:name?", "/files/:name(\\d+)", "/files/{:name}"]) {
        try {
          compilePathPattern(pattern);
          expect.fail(`expected "${pattern}" to be rejected`);
        } catch (error) {
          expect(error).toBeInstanceOf(ConnectorError);
          expect((error as ConnectorError).code).toBe("UNSUPPORTED_ROUTE_PATTERN");
          expect((error as Error).message).toContain(pattern);
        }
      }
    });
  });

  describe("* wildcard tails in every spelling NestJS 11 produces or accepts", () => {
    it.each([
      ["legacy unnamed /*", "/*"],
      ["legacy /(.*) mount form", "/(.*)"],
      ["Express-5 named wildcard /*path", "/*path"],
      ["Express-5 braced wildcard /{*path}", "/{*path}"],
    ])("%s matches everything", (_label, wildcard) => {
      const pattern = compilePathPattern(wildcard);
      expect(pattern.match("/any/deep/path").matched).toBe(true);
      expect(pattern.match("/").matched).toBe(true);
    });

    it("matches any remaining path including empty remainder behind a static prefix", () => {
      const pattern = compilePathPattern("/assets/*");
      expect(pattern.match("/assets/img/logo.png").matched).toBe(true);
      expect(pattern.match("/assets").matched).toBe(true);
    });

    it("requires the wildcard prefix to match first", () => {
      const pattern = compilePathPattern("/assets/*");
      expect(pattern.match("/images/logo.png").matched).toBe(false);
    });

    it("rejects wildcards that are not the final segment", () => {
      try {
        compilePathPattern("/a/*/b");
        expect.fail("expected mid-path wildcard to be rejected");
      } catch (error) {
        expect((error as ConnectorError).code).toBe("UNSUPPORTED_ROUTE_PATTERN");
        expect((error as Error).message).toContain("final segment");
      }
    });
  });

  describe("mount-exactness marker produced by Nest's middleware path extractor", () => {
    // With app.setGlobalPrefix('api') and forRoutes('*'), RouteInfoPathExtractor
    // yields "/api$" (exact prefix) plus "/api/*" (everything beneath it).
    it("matches only the exact path for prefix mounts", () => {
      const pattern = compilePathPattern("/api$");
      expect(pattern.matchesPrefix("/api")).toBe(true);
      expect(pattern.matchesPrefix("/api/items")).toBe(false);
    });

    it("keeps directory-prefix semantics without the marker", () => {
      const pattern = compilePathPattern("/api");
      expect(pattern.matchesPrefix("/api")).toBe(true);
      expect(pattern.matchesPrefix("/api/items")).toBe(true);
    });

    it("rejects dollar signs anywhere except the terminal position", () => {
      try {
        compilePathPattern("/a$b/route");
        expect.fail("expected embedded $ to be rejected");
      } catch (error) {
        expect((error as ConnectorError).code).toBe("UNSUPPORTED_ROUTE_PATTERN");
      }
    });
  });

  describe("structural validation", () => {
    it("rejects patterns without a leading slash", () => {
      expect(() => compilePathPattern("health")).toThrow(/must start with/);
    });

    it("rejects non-string route paths such as RegExp objects", () => {
      expect(() => compilePathPattern(new RegExp("^/x$") as unknown as string)).toThrow(
        /route paths must be strings/,
      );
    });

    it("matches root-mount patterns against every request path", () => {
      const pattern = compilePathPattern("/");
      expect(pattern.matchesPrefix("/anything")).toBe(true);
      expect(pattern.matchesPrefix("/")).toBe(true);
    });
  });
});
