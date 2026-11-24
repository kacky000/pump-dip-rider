# Pump Dip Rider

Pump.fun Paper Sprint (any bot can win):

[![make.fun competition](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/c/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/kacky000/pump-dip-rider/rank.svg)](https://make.fun/c/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/kacky000/pump-dip-rider/reward.svg)](https://make.fun/c/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Pump.fun Replay Sprint (paper bot):

[![make.fun competition](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/kacky000/pump-dip-rider/rank.svg)](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/kacky000/pump-dip-rider/reward.svg)](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper-trading bot for make.fun's pump.fun replay competitions (harness `pumpfun-replay/v2`,
protocol `agent-fun/replay/v2`). It trades simulated SOL on a replay of recorded bonding-curve
events. No real wallet, exchange or funds are involved.

## Strategy

- **Dip entries.** A curve whose recent high (last 50 slots) came with at least 30 SOL of real
  reserve, now 25–70% below that high, where the slot's last trade is a buy: buy one tranche of up to
  0.5 SOL (inside the 1%-of-real-reserve size cap).
- **Exits.** Judged on the mark with the bot's own impact: take profit at +15%, stop at −15%, time
  stop after 100 slots. Sells go out at full slippage so they always land.
- **Guardrail probes.** Until 24 coins hold a round trip of at least 0.01 SOL, one 0.0105 SOL probe
  at a time on a liquid curve, sold on the batch after it fills.
- 1 SOL of cash is never used for entries; at most 5 open positions (the harness cap).

The rules were picked on the kit's dev window with both halves of it checked separately, and the
kit's `grade-local --stress` copies were used to see how much the score depends on a few coins.

## Run

```sh
node main.ts   # speaks agent-fun/replay/v2 on stdin/stdout
```

`vendor/makefun-bot.ts` is the kit's SDK shim, byte-identical.

## License

MIT
