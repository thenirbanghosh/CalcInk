import { isDigit, isOperator, type Sym } from '../math/tokens';

const B = { Start: 0, Neg: 1, Int: 2, IntDot: 3, LeadDot: 4, Frac: 5, Op: 6 } as const;
const SIDE = 7;

export const G = {
  Start: B.Start,
  Neg: B.Neg,
  Int: B.Int,
  IntDot: B.IntDot,
  LeadDot: B.LeadDot,
  Frac: B.Frac,
  Op: B.Op,
  Eq: SIDE + B.Start,
  Error: 2 * SIDE,
} as const;
export type G = number;

export const STATE_COUNT = 2 * SIDE + 1;

function step(pos: number, s: Sym): number {
  const d = isDigit(s);
  switch (pos) {
    case B.Start:
    case B.Op:
      return d ? B.Int : s === '.' ? B.LeadDot : s === '-' || s === '+' ? B.Neg : -1;
    case B.Neg:
      return d ? B.Int : s === '.' ? B.LeadDot : -1;
    case B.Int:
      return d ? B.Int : s === '.' ? B.IntDot : isOperator(s) ? B.Op : -1;
    case B.IntDot:
      return d ? B.Frac : isOperator(s) ? B.Op : -1;
    case B.LeadDot:
      return d ? B.Frac : -1;
    case B.Frac:
      return d ? B.Frac : isOperator(s) ? B.Op : -1;
  }
  return -1;
}

const complete = (pos: number) => pos === B.Int || pos === B.IntDot || pos === B.Frac;

export function next(state: G, s: Sym): G {
  if (state === G.Error) return G.Error;
  const side = state >= SIDE ? 1 : 0;
  const pos = state - side * SIDE;
  if (s === '=') return side === 0 && complete(pos) ? G.Eq : G.Error;
  const n = step(pos, s);
  return n < 0 ? G.Error : side * SIDE + n;
}

export function finalCost(state: G): number {
  if (state === G.Error || state === G.Eq) return 0;
  const pos = state % SIDE;
  if (pos === B.Int || pos === B.Frac) return 0;
  if (pos === B.IntDot) return -2;
  return -3;
}

export const ERROR_COST = Math.log(1e-4);

// "=" right after an operator usually means a digit was just erased, so keep it cheap.
// otherwise "14 + =" gets "fixed" into something like "14 - 1 = 13"
export const EDIT_COST = Math.log(0.05);

export function transitionCost(state: G, s: Sym, nextState: G): number {
  if (nextState !== G.Error || state === G.Error) return 0;
  if (s === '=' && state < SIDE && !complete(state)) return EDIT_COST;
  return ERROR_COST;
}
