// Compile fixture (spec 003, US3/AC2): context contracts via the /context subpath.
import { YandexContext } from "@ycforge/nestjs-connector/context";
import type { YandexExecutionContext } from "@ycforge/nestjs-connector/context";

class Probe {
  inspect(@YandexContext() context: YandexExecutionContext): string {
    return context.awsRequestId;
  }
}

export const probe = Probe;
