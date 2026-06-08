import { startBot } from "./bot";
import { logger } from "./lib/logger";

startBot().catch((err) => {
  logger.error({ err }, "Fatal error — bot crashed");
  process.exit(1);
});
