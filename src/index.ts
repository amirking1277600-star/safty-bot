import { startBot } from "./bot.ts";
import { logger } from "./lib/logger.ts";

startBot().catch((err) => {
  logger.error({ err }, "Fatal error — bot crashed");
  process.exit(1);
});
