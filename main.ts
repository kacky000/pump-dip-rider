// Entry point the grader runs as `node /bot/main.ts`: the dip rider in strategy.ts on the
// agent-fun/replay/v2 wire, through the kit's SDK shim (vendor/makefun-bot.ts, byte-identical).
import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot({ onBatch: createStrategy(DEFAULT_PARAMS) });
