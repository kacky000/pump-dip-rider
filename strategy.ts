// Dip rider for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// Idea: a curve that has already drawn real money (its recent high came with at least minHighRq
// SOL of real reserve) and then fell hard from that high, while the last trade of the slot is a buy,
// tends to bounce a little. Buy one tranche (within the 1%-of-real-reserve cap), take a small profit,
// cut a small loss, and never hold long. Exits are judged on the mark (the curve's latest reserves,
// our own impact included), so a sell sees the price we would really get.
//
// Guardrails: the final ranks entries that round-trip at least 0.01 SOL on at least 20 coins above
// all others, and a 6-hour window may not offer 20 dips. So the bot also runs probes: while fewer
// than probeTarget coins have a completed round trip, it buys probeLamports of a liquid curve and
// sells it on the next batch after the buy fills.
//
// Deterministic: no clock, no randomness, only insertion-ordered maps fed by the batch stream.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Slots of tape kept per curve: the recent high is taken over this lookback. */
  look: number;
  /** Price must sit this far below the recent high (fraction), but not further than ddMax. */
  ddMin: number;
  ddMax: number;
  /** Real SOL reserve (lamports) at the recent high, at least. */
  minHighRq: bigint;
  /** Real SOL reserve (lamports) now, at least. */
  minRqNow: bigint;
  /** The slot's last trade on the curve must be a buy. */
  lastMustBeBuy: boolean;
  /** Lamports per entry (capped by the per-reply size cap). */
  stake: bigint;
  /** Smallest entry worth its tx fees. */
  minEntry: bigint;
  /** Exits, as fractions of the entry cost, and a time stop in slots. */
  takeProfit: number;
  stopLoss: number;
  maxHold: number;
  /** Slots a curve rests after an exit before it can be bought again. */
  cooldown: number;
  /** Slippage on entries (bps); exits always go out at 10000. */
  buySlipBps: number;
  /** Probe round trips until this many coins have one. */
  probeTarget: number;
  probeLamports: bigint;
  /** A probe curve holds at least this much real SOL (so the cap allows probeLamports). */
  probeMinRq: bigint;
  /** Cash kept aside (lamports): entries never dip into it. */
  reserve: bigint;
}

export const DEFAULT_PARAMS: Params = {
  look: 50,
  ddMin: 0.25,
  ddMax: 0.7,
  minHighRq: 30_000_000_000n,
  minRqNow: 3_000_000_000n,
  lastMustBeBuy: true,
  stake: 500_000_000n,
  minEntry: 50_000_000n,
  takeProfit: 0.15,
  stopLoss: 0.15,
  maxHold: 100,
  cooldown: 50,
  buySlipBps: 2_000,
  probeTarget: 24,
  probeLamports: 10_500_000n,
  probeMinRq: 3_000_000_000n,
  reserve: 1_000_000_000n,
};

interface Tick {
  slot: number;
  /** Price as virtual quote / virtual token, scaled to a float. */
  price: number;
  rq: bigint;
  buy: boolean;
}

interface Trip {
  /** Probe or dip entry. */
  probe: boolean;
  /** Slot the buy was decided on. */
  decided: number;
  /** Slot the buy filled; -1 until it does. */
  filled: number;
  /** A sell has been sent and not yet answered. */
  selling: boolean;
}

const price = (vq: bigint, vt: bigint): number => (vt === 0n ? 0 : Number(vq) / Number(vt));

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const tapes = new Map<Pubkey, Tick[]>();
  const trips = new Map<Pubkey, Trip>();
  const restUntil = new Map<Pubkey, number>();
  /** Coins with a finished round trip of at least 0.01 SOL. */
  const roundTripped = new Set<Pubkey>();
  const boughtBig = new Set<Pubkey>();

  function record(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      let tape = tapes.get(e.mint);
      if (tape === undefined) {
        tape = [];
        tapes.set(e.mint, tape);
      }
      tape.push({ slot: e.slot, price: price(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)), rq: BigInt(e.real_quote_reserves), buy: e.is_buy });
      while (tape.length > 0 && tape[0].slot < e.slot - p.look) tape.shift();
    }
  }

  function settle(state: BotState, batch: Batch): void {
    for (const f of batch.fills) {
      const t = trips.get(f.mint);
      if (f.side === 'buy') {
        if (t === undefined) continue;
        if (f.status === 'filled') {
          t.filled = f.slot;
          if (BigInt(f.quote_lamports) >= 10_000_000n) boughtBig.add(f.mint);
        } else if (!state.positions.has(f.mint)) trips.delete(f.mint);
      } else {
        if (t !== undefined) t.selling = false;
        if (!state.positions.has(f.mint)) {
          if (f.status === 'filled' && boughtBig.has(f.mint)) roundTripped.add(f.mint);
          trips.delete(f.mint);
          restUntil.set(f.mint, f.slot + p.cooldown);
        }
      }
    }
  }

  return function onBatch(state: BotState, batch: Batch): OrderInput[] {
    record(batch);
    settle(state, batch);
    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();

    // Exits first.
    for (const [mint, h] of state.positions) {
      if (orders.length >= cap) break;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete || h.token_amount === 0n) continue;
      let t = trips.get(mint);
      if (t === undefined) {
        t = { probe: false, decided: batch.slot, filled: batch.slot, selling: false };
        trips.set(mint, t);
      }
      if (t.selling || t.filled < 0) continue;
      let exit = t.probe;
      if (!exit) {
        // Value of the tokens at the current reserves, before curve fees.
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        const out = (h.token_amount * vq) / (vt + h.token_amount);
        const ratio = Number(out) / Number(h.cost_lamports);
        exit = ratio >= 1 + p.takeProfit || ratio <= 1 - p.stopLoss || batch.slot - t.filled >= p.maxHold;
      }
      if (exit) {
        orders.push({ side: 'sell', mint, token_amount: h.token_amount, max_slippage_bps: 10_000 });
        t.selling = true;
      }
    }

    let free = state.freeCashLamports();
    let slots = state.hello.caps.max_open_positions - state.committedPositionCount();
    const probing = roundTripped.size + [...trips.values()].filter((t) => t.probe).length < p.probeTarget;
    // Keep one slot for probes while they are still needed.
    const dipSlots = probing ? slots - 1 : slots;
    let dipsLeft = dipSlots;

    // Dip entries, on curves that traded this slot.
    const seen = new Set<Pubkey>();
    for (let i = batch.events.length - 1; i >= 0; i--) {
      const e = batch.events[i];
      if (e.event !== 'TradeEvent' || seen.has(e.mint)) continue;
      seen.add(e.mint);
      if (orders.length >= cap || dipsLeft <= 0) break;
      const mint = e.mint;
      if (trips.has(mint) || state.positions.has(mint)) continue;
      if ((restUntil.get(mint) ?? -1) > batch.slot) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete || curve.created_slot === null) continue;
      if (p.lastMustBeBuy && !e.is_buy) continue;
      if (curve.real_quote_reserves < p.minRqNow) continue;
      const tape = tapes.get(mint) ?? [];
      let hi = 0;
      let hiRq = 0n;
      for (const k of tape) if (k.price > hi) {
        hi = k.price;
        hiRq = k.rq;
      }
      if (hi === 0 || hiRq < p.minHighRq) continue;
      const now = price(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      const dd = 1 - now / hi;
      if (dd < p.ddMin || dd > p.ddMax) continue;
      let amount = state.maxBuyLamports(mint);
      if (amount > p.stake) amount = p.stake;
      if (amount < p.minEntry || free - amount - 2n * tx < p.reserve) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
      trips.set(mint, { probe: false, decided: batch.slot, filled: -1, selling: false });
      free -= amount + tx;
      dipsLeft -= 1;
      slots -= 1;
    }

    // One probe at a time, on a liquid curve that traded this slot.
    if (probing && slots > 0 && orders.length < cap && ![...trips.values()].some((t) => t.probe)) {
      for (const e of batch.events) {
        if (e.event !== 'TradeEvent') continue;
        const mint = e.mint;
        if (trips.has(mint) || state.positions.has(mint) || roundTripped.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete || curve.created_slot === null) continue;
        if (curve.real_quote_reserves < p.probeMinRq || state.maxBuyLamports(mint) < p.probeLamports) continue;
        if (free - p.probeLamports - 2n * tx < 0n) break;
        orders.push({ side: 'buy', mint, quote_lamports: p.probeLamports, max_slippage_bps: 10_000 });
        trips.set(mint, { probe: true, decided: batch.slot, filled: -1, selling: false });
        break;
      }
    }
    return orders;
  };
}
