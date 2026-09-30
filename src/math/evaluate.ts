import { parseExpression, type Expr } from './parser';
import { DivisionByZeroError, Rational } from './rational';
import type { Sym } from './tokens';

export function evaluateExpr(e: Expr): Rational {
  switch (e.type) {
    case 'num':
      return e.value;
    case 'neg':
      return evaluateExpr(e.arg).neg();
    case 'bin': {
      const l = evaluateExpr(e.left);
      const r = evaluateExpr(e.right);
      switch (e.op) {
        case '+':
          return l.add(r);
        case '-':
          return l.sub(r);
        case '×':
          return l.mul(r);
        case '÷':
          return l.div(r);
      }
    }
  }
}

export type LineVerdict =
  | { kind: 'incomplete' }
  | { kind: 'value'; value: Rational; eqIndex: number }
  | { kind: 'check'; value: Rational; claimed: Rational; correct: boolean; eqIndex: number }
  | { kind: 'undefined'; eqIndex: number }
  | { kind: 'error'; message: string; at: number; eqIndex: number };

export function evaluateLine(symbols: readonly Sym[]): LineVerdict {
  const eqIndex = symbols.indexOf('=');
  if (eqIndex < 0) return { kind: 'incomplete' };

  const second = symbols.indexOf('=', eqIndex + 1);
  if (second >= 0) return { kind: 'error', message: 'Only one = per line', at: second, eqIndex };

  const lhs = parseExpression(symbols, 0, eqIndex);
  if (!lhs.ok) return { kind: 'error', ...lhs.error, eqIndex };

  let value: Rational;
  try {
    value = evaluateExpr(lhs.expr);
  } catch (err) {
    if (err instanceof DivisionByZeroError) return { kind: 'undefined', eqIndex };
    return { kind: 'error', message: 'Could not evaluate', at: 0, eqIndex };
  }

  if (eqIndex === symbols.length - 1) return { kind: 'value', value, eqIndex };

  const rhs = parseExpression(symbols, eqIndex + 1);
  if (!rhs.ok) return { kind: 'error', ...rhs.error, eqIndex };
  let claimed: Rational;
  try {
    claimed = evaluateExpr(rhs.expr);
  } catch {
    return { kind: 'undefined', eqIndex };
  }
  return { kind: 'check', value, claimed, correct: claimed.equals(value), eqIndex };
}
