import { Rational } from './rational';
import { isDigit, type Sym } from './tokens';

export type Expr =
  | { type: 'num'; value: Rational; text: string; start: number; end: number }
  | { type: 'neg'; arg: Expr; start: number }
  | { type: 'bin'; op: '+' | '-' | '×' | '÷'; left: Expr; right: Expr; at: number };

export interface ParseError {
  message: string;
  at: number;
}

export type ParseResult = { ok: true; expr: Expr } | { ok: false; error: ParseError };

class Failure {
  constructor(readonly error: ParseError) {}
}

const OP_NAMES: Record<string, string> = { '+': '+', '-': '−', '×': '×', '÷': '÷', '=': '=' };

export function parseExpression(symbols: readonly Sym[], from = 0, to = symbols.length): ParseResult {
  let pos = from;
  const fail = (message: string, at = pos): never => {
    throw new Failure({ message, at });
  };
  const peek = (): Sym | undefined => (pos < to ? symbols[pos] : undefined);

  function number(): Expr {
    const start = pos;
    let text = '';
    let dots = 0;
    while (pos < to) {
      const s = symbols[pos]!;
      if (isDigit(s)) text += s;
      else if (s === '.') {
        if (++dots > 1) fail('A number can only have one decimal point');
        text += '.';
      } else break;
      pos++;
    }
    if (text === '') {
      const s = peek();
      if (s === undefined) fail(start === from ? 'Nothing to calculate' : 'Missing a number at the end');
      fail(`Expected a number before ${OP_NAMES[s!] ?? s}`);
    }
    const value = Rational.parseDecimal(text);
    if (!value) fail('A lone decimal point is not a number', start);
    return { type: 'num', value: value!, text, start, end: pos };
  }

  function unary(): Expr {
    const s = peek();
    if (s === '-' || s === '+') {
      const start = pos++;
      const arg = unary();
      return s === '-' ? { type: 'neg', arg, start } : arg;
    }
    return number();
  }

  function term(): Expr {
    let left = unary();
    for (let s = peek(); s === '×' || s === '÷'; s = peek()) {
      const at = pos++;
      if (pos >= to) fail(`Missing a number after ${OP_NAMES[s]}`, at);
      left = { type: 'bin', op: s, left, right: unary(), at };
    }
    return left;
  }

  function expr(): Expr {
    let left = term();
    for (let s = peek(); s === '+' || s === '-'; s = peek()) {
      const at = pos++;
      if (pos >= to) fail(`Missing a number after ${OP_NAMES[s]}`, at);
      left = { type: 'bin', op: s, left, right: term(), at };
    }
    return left;
  }

  try {
    if (from >= to) fail('Nothing to calculate', from);
    const e = expr();
    if (pos < to) {
      const s = symbols[pos]!;
      fail(isDigit(s) || s === '.' ? 'Unexpected number' : `Unexpected ${OP_NAMES[s] ?? s}`);
    }
    return { ok: true, expr: e };
  } catch (err) {
    if (err instanceof Failure) return { ok: false, error: err.error };
    throw err;
  }
}
