import { ConnectorError } from "../core/connector-error";

/**
 * Route path matching for the in-memory dispatcher (issue #6).
 *
 * The connector replaces the platform router with a small deterministic
 * matcher. NestJS hands routes and middleware mounts to
 * {@link YandexHttpAdapter} as plain strings composed from user decorators
 * plus controller/module/global prefixes (verified against @nestjs/core 11
 * `RoutePathFactory.create` and `RouteInfoPathExtractor.extractPathsFrom`);
 * nothing validates the syntax before it arrives here. The supported subset
 * below is therefore an explicit compatibility contract:
 *
 * **Supported patterns** — everything conventional NestJS controllers need:
 * - static segments: `/cats`, `/users/profile`;
 * - single-segment parameters: `/cats/:id`;
 * - tail wildcards in every spelling Nest 11 / Express 5 era code produces:
 *   `/*`, `/*name`, `/{*name}` and the legacy `/(.*)` mount form;
 * - mount-exactness marker `/api$` (produced by Nest's own middleware path
 *   extractor for `forRoutes('*')` under a global prefix): prefix matching
 *   then requires full equality instead of a directory-prefix;
 * - trailing slashes are ignored and comparison is case-insensitive,
 *   mirroring the platform default router.
 *
 * **Rejected patterns** — fail fast at registration (cold start) with a
 * {@link ConnectorError} of code `UNSUPPORTED_ROUTE_PATTERN` instead of
 * silently misrouting: regular-expression or quantifier syntax (`a(b)?c`,
 * `:id(\d+)`), optional or brace-wrapped parameters (`:id?`, `{:id}`), and
 * wildcards outside the final segment. Non-string values (e.g. a RegExp
 * passed to a route decorator) are rejected the same way.
 *
 * Matching operates on the decoded `rawPath` (DATA-ANALYSE.md section E3), so
 * an encoded `%2F` inside one segment behaves like a separator.
 */

export interface PathPatternMatch {
  /** True when the pattern covers the request path. */
  readonly matched: boolean;
  /** Captured `:param` values, keyed by name (empty when unmatched). */
  readonly params: Readonly<Record<string, string>>;
}

type PatternSegment =
  { kind: "literal"; value: string } | { kind: "param"; name: string } | { kind: "wildcard" };

/**
 * A compiled route pattern reusable across invocations; compilation happens
 * once per route during cold-start registration, never per dispatch.
 */
export interface CompiledPathPattern {
  readonly source: string;
  match(path: string): PathPatternMatch;
  /** Express-style prefix test used by middleware mounts (`app.use('/x', …)`). */
  matchesPrefix(path: string): boolean;
}

const NO_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

const PARAM_NAME = /^[A-Za-z0-9_]+$/;

/** Tail-wildcard spellings accepted verbatim; all behave identically. */
const WILDCARD_SEGMENT = /^\*$|^\(\.\*\)$|^\*[A-Za-z0-9_]+$|^\{\*[A-Za-z0-9_]*\}$/;

function splitSegments(path: string): string[] {
  // Trailing slashes never contribute a segment (Express normalizes them).
  const withoutTrailingSlash = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return withoutTrailingSlash.split("/").filter((segment) => segment.length > 0);
}

function parseSegment(raw: string, pattern: string): PatternSegment {
  if (WILDCARD_SEGMENT.test(raw)) {
    return { kind: "wildcard" };
  }
  if (raw.startsWith(":")) {
    const name = raw.slice(1);
    if (!PARAM_NAME.test(name)) {
      throw ConnectorError.unsupportedRoutePattern(
        pattern,
        `parameter segment "${raw}" is not a plain ":name"; optional/regex parameters are not supported`,
      );
    }
    return { kind: "param", name };
  }
  // Any regex/quantifier/brace syntax left in a literal segment would change
  // meaning silently on the platforms this contract mirrors; refuse instead.
  if (/[?(){}$:]/.test(raw)) {
    throw ConnectorError.unsupportedRoutePattern(
      pattern,
      `segment "${raw}" uses unsupported syntax; only static text, ":name" and tail wildcards are supported`,
    );
  }
  return { kind: "literal", value: raw };
}

/**
 * Compiles a route/mount path string. Throws a `ConnectorError` (code
 * `UNSUPPORTED_ROUTE_PATTERN`) for anything outside the documented subset so
 * misconfiguration surfaces at cold start, not per invocation.
 */
export function compilePathPattern(pattern: string): CompiledPathPattern {
  if (typeof pattern !== "string") {
    throw ConnectorError.unsupportedRoutePattern(
      String(pattern),
      "route paths must be strings; array entries are registered separately by NestJS",
    );
  }

  // Nest's RouteInfoPathExtractor appends "$" to mark mounts that must match
  // the global prefix exactly rather than as a directory prefix.
  let source = pattern;
  let exactMount = false;
  if (source.length > 1 && source.endsWith("$")) {
    source = source.slice(0, -1);
    exactMount = true;
  }

  if (!source.startsWith("/")) {
    throw ConnectorError.unsupportedRoutePattern(pattern, 'route paths must start with "/"');
  }
  const segments = splitSegments(source).map((raw) => parseSegment(raw, pattern));
  let sawWildcard = false;
  for (const segment of segments) {
    if (sawWildcard) {
      throw ConnectorError.unsupportedRoutePattern(
        pattern,
        "wildcard segments must be the final segment",
      );
    }
    if (segment.kind === "wildcard") {
      sawWildcard = true;
    }
  }

  return {
    source: pattern,

    match(path: string): PathPatternMatch {
      const requestSegments = splitSegments(path);
      const params: Record<string, string> = {};

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        if (segment.kind === "wildcard") {
          return { matched: true, params };
        }
        const requestSegment = requestSegments[index];
        if (requestSegment === undefined) {
          return { matched: false, params: NO_PARAMS };
        }
        if (segment.kind === "literal") {
          if (segment.value.toLowerCase() !== requestSegment.toLowerCase()) {
            return { matched: false, params: NO_PARAMS };
          }
          continue;
        }
        // Parameter capture: any single non-empty segment (splitSegments
        // already guarantees non-emptiness).
        params[segment.name] = requestSegment;
      }

      const matched = requestSegments.length === segments.length;
      return matched ? { matched: true, params } : { matched: false, params: NO_PARAMS };
    },

    matchesPrefix(path: string): boolean {
      if (exactMount) {
        return segmentsEqual(splitSegments(source), splitSegments(path));
      }
      if (segments.length === 0) {
        return true;
      }
      const requestSegments = splitSegments(path);
      if (requestSegments.length < segments.length) {
        return false;
      }
      // Prefix semantics mirror Express mounts: every pattern segment must
      // match the corresponding request segment; anything beyond the pattern
      // is allowed through.
      return segments.every((segment, index) => {
        const requestSegment = requestSegments[index]!;
        if (segment.kind === "wildcard" || segment.kind === "param") {
          return true;
        }
        return segment.value.toLowerCase() === requestSegment.toLowerCase();
      });
    },
  };
}

function segmentsEqual(patternSegments: string[], candidateSegments: string[]): boolean {
  if (patternSegments.length !== candidateSegments.length) {
    return false;
  }
  return patternSegments.every(
    (segment, index) => segment.toLowerCase() === candidateSegments[index]!.toLowerCase(),
  );
}
