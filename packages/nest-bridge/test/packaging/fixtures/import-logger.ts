// Compile fixture (spec 004, US4/SC-006 addition): the observability subset via
// the /logger subpath, without any root-barrel import (FR-008).
import { YandexLogger } from "@ycforge/nestjs-connector/logger";
import type { YandexLogLevel } from "@ycforge/nestjs-connector/logger";

declare const logger: YandexLogger;
declare const level: YandexLogLevel;

logger.debug("debug message", { userId: 7 });
logger.info("info message");
logger.warn("warn message");
logger.error("error message");

export const sampleLevel: YandexLogLevel = level;