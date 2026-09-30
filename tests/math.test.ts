import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluateLine, evaluateExpr } from '../src/math/evaluate';
import { parseExpression } from '../src/math/parser';
import { Rational, DivisionByZeroError } from '../src/math/rational';
import { formatRational } from '../src/math/format';
import { formatExpression, type Sym } from '../src/math/tokens';

const syms = (s: string) => [...s.replace(/\s/g, '')] as Sym[];
const value = (s: string) => {
  const v = evaluateLine(syms(s));
  if (v.kind !== 'value') throw new Error(`expected value for ${s}, got ${JSON.stringify(v)}`);
  return formatRational(v.value).text;
};

describe('Rational', () => {
  it('normalizes sign and lowest terms', () => {
    expect(Rational.of(6, -8).toString()).toBe('-3/4');
    expect(Rational.of(0, 5).toString()).toBe('0');
  });
  it('parses decimal literals exactly', () => {
    expect(Rational.parseDecimal('0.1')!.toString()).toBe('1/10');
    expect(Rational.parseDecimal('.5')!.toString()).toBe('1/2');
    expect(Rational.parseDecimal('7.')!.toString()).toBe('7');
    expect(Rational.parseDecimal('007.250')!.toString()).toBe('29/4');
    expect(Rational.parseDecimal('.')).toBeNull();
    expect(Rational.parseDecimal('1.2.3')).toBeNull();
  });
  it('0.1 + 0.2 is exactly 0.3', () => {
    const r = Rational.parseDecimal('0.1')!.add(Rational.parseDecimal('0.2')!);
    expect(r.equals(Rational.parseDecimal('0.3')!)).toBe(true);
  });
  it('throws a typed error on division by zero', () => {
    expect(() => Rational.ONE.div(Rational.ZERO)).toThrow(DivisionByZeroError);
    expect(() => Rational.of(1, 0)).toThrow(DivisionByZeroError);
  });
  it('toNumber survives huge operands', () => {
    expect(Rational.of(10n ** 400n + 1n, 10n ** 399n).toNumber()).toBeCloseTo(10);
  });
});

describe('operator precedence (BODMAS/PEMDAS)', () => {
  it.each([
    ['18+4×3=', '30'],
    ['2+3×4-6÷2=', '11'],
    ['2-3-4=', '-5'],
    ['8÷4÷2=', '1'],
    ['100÷10×10=', '100'],
    ['1-2+3=', '2'],
    ['2×3+4×5=', '26'],
    ['7=', '7'],
  ])('%s gives %s', (expr, expected) => expect(value(expr)).toBe(expected));
});

describe('numbers', () => {
  it.each([
    ['123+877=', '1000'],
    ['0.1+0.2=', '0.3'],
    ['.5+.5=', '1'],
    ['3.75×4=', '15'],
    ['1.5÷0.5=', '3'],
    ['007+3=', '10'],
    ['2.50×2=', '5'],
  ])('%s gives %s', (expr, expected) => expect(value(expr)).toBe(expected));
});

describe('negative numbers', () => {
  it.each([
    ['-5+3=', '-2'],
    ['5×-2=', '-10'],
    ['-3×-3=', '9'],
    ['5--2=', '7'],
    ['--4=', '4'],
    ['-0.5×4=', '-2'],
    ['3-10=', '-7'],
    ['6÷-4=', '-1.5'],
  ])('%s gives %s', (expr, expected) => expect(value(expr)).toBe(expected));
});

describe('division by zero is Undefined, never an exception', () => {
  it.each(['5÷0=', '0÷0=', '1+2÷0=', '3÷0.0=', '8÷0×2=', '2÷0=5'])('%s', (expr) => {
    expect(evaluateLine(syms(expr)).kind).toBe('undefined');
  });
  it('only a zero divisor triggers it', () => {
    expect(evaluateLine(syms('0÷5=')).kind).toBe('value');
  });
});

describe('malformed input produces errors, not exceptions', () => {
  it.each([
    ['+=', 'Missing a number'],
    ['3+=', 'Missing a number after +'],
    ['=', 'Nothing to calculate'],
    ['3..4=', 'one decimal point'],
    ['1.2.3=', 'one decimal point'],
    ['.=', 'lone decimal point'],
    ['3××4=', 'Expected a number'],
    ['2=3=', 'Only one ='],
    ['×5=', 'Expected a number'],
  ])('%s', (expr, msg) => {
    const v = evaluateLine(syms(expr));
    expect(v.kind).toBe('error');
    if (v.kind === 'error') expect(v.message).toContain(msg);
  });
  it('points at the offending symbol', () => {
    const v = evaluateLine(syms('12+×3='));
    expect(v.kind === 'error' && v.at).toBe(3);
  });
  it('a line without = is incomplete', () => {
    expect(evaluateLine(syms('12+3')).kind).toBe('incomplete');
    expect(evaluateLine([]).kind).toBe('incomplete');
  });
});

describe('answer checking (writer supplies the result)', () => {
  it('marks a correct answer', () => {
    const v = evaluateLine(syms('18+4×3=30'));
    expect(v.kind === 'check' && v.correct).toBe(true);
  });
  it('marks a wrong answer and keeps the true value', () => {
    const v = evaluateLine(syms('18+4×3=66'));
    expect(v.kind).toBe('check');
    if (v.kind === 'check') {
      expect(v.correct).toBe(false);
      expect(formatRational(v.value).text).toBe('30');
    }
  });
  it('accepts equivalent decimals', () => {
    const v = evaluateLine(syms('1÷4=0.250'));
    expect(v.kind === 'check' && v.correct).toBe(true);
  });
});

describe('formatting', () => {
  const f = (a: bigint | number, b: bigint | number = 1n) => formatRational(Rational.of(a, b));
  it('finds repeating blocks', () => {
    expect(f(1, 3).text).toBe('0.(3)');
    expect(f(1, 6).text).toBe('0.1(6)');
    expect(f(1, 7).text).toBe('0.(142857)');
    expect(f(-22, 7).text).toBe('-3.(142857)');
    expect(f(1, 6).repeat).toBe('6');
  });
  it('rounds long periods with an ellipsis', () => {
    const r = f(1, 17);
    expect(r.text).toBe('0.0588235294…');
    expect(r.rounded).toBe(true);
  });
  it('terminating decimals are exact', () => {
    expect(f(1, 8).text).toBe('0.125');
    expect(f(-5, 2).text).toBe('-2.5');
    expect(f(0).text).toBe('0');
  });
  it('switches to scientific for very large and very small values', () => {
    expect(f(10n ** 20n).text).toBe('1e+20');
    expect(f(123456789n * 10n ** 12n).text).toBe('1.2345679e+20');
    expect(f(1, 10n ** 9n).text).toBe('1e-9');
    expect(f(-3, 10n ** 7n).text).toBe('-3e-7');
  });
  it('offers a fraction for non-integers', () => {
    expect(f(1, 3).fraction).toBe('1/3');
    expect(f(4).fraction).toBeNull();
  });
});

describe('expression display', () => {
  it('uses a true minus and distinguishes unary minus', () => {
    expect(formatExpression(syms('5×-2='))).toBe('5 × −2 =');
    expect(formatExpression(syms('18+4×3='))).toBe('18 + 4 × 3 =');
  });
});

type Tree = { k: 'num'; v: string } | { k: 'op'; op: '+' | '-' | '×' | '÷'; l: Tree; r: Tree };
const numLit = fc
  .tuple(fc.integer({ min: 0, max: 999 }), fc.option(fc.integer({ min: 0, max: 99 }), { nil: undefined }))
  .map(([i, f]) => (f === undefined ? String(i) : `${i}.${f}`));
const tree: fc.Arbitrary<Tree> = fc.letrec<{ t: Tree }>((tie) => ({
  t: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    numLit.map((v): Tree => ({ k: 'num', v })),
    fc.record({ k: fc.constant('op' as const), op: fc.constantFrom('+', '-', '×', '÷'), l: tie('t'), r: tie('t') }),
  ),
})).t;
const prec = (op: string) => (op === '+' || op === '-' ? 1 : 2);
function evalTree(t: Tree): Rational {
  if (t.k === 'num') return Rational.parseDecimal(t.v)!;
  const l = evalTree(t.l);
  const r = evalTree(t.r);
  return t.op === '+' ? l.add(r) : t.op === '-' ? l.sub(r) : t.op === '×' ? l.mul(r) : l.div(r);
}
function render(t: Tree, parentPrec = 0, rightChild = false): string | null {
  if (t.k === 'num') return t.v;
  const p = prec(t.op);
  if (p < parentPrec || (rightChild && p === parentPrec)) return null;
  const l = render(t.l, p, false);
  const r = render(t.r, p, true);
  return l === null || r === null ? null : l + t.op + r;
}

describe('property: parser agrees with direct tree evaluation', () => {
  it('holds for 2000 random parenthesis-free expressions', () => {
    fc.assert(
      fc.property(tree, (t) => {
        const text = render(t);
        fc.pre(text !== null);
        let expected: Rational | 'undef';
        try {
          expected = evalTree(t);
        } catch {
          expected = 'undef';
        }
        const v = evaluateLine(syms(text + '='));
        if (expected === 'undef') return v.kind === 'undefined';
        return v.kind === 'value' && v.value.equals(expected);
      }),
      { numRuns: 2000 },
    );
  });
  it('never throws on arbitrary symbol soup', () => {
    const sym = fc.constantFrom<Sym>('0', '1', '5', '9', '+', '-', '×', '÷', '.', '=');
    fc.assert(
      fc.property(fc.array(sym, { maxLength: 24 }), (s) => {
        const v = evaluateLine(s);
        return ['incomplete', 'value', 'check', 'undefined', 'error'].includes(v.kind);
      }),
      { numRuns: 5000 },
    );
  });
  it('agrees with floating point to 1e-9 relative on integer expressions', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 99 }), fc.constantFrom('+', '-', '×')), { minLength: 1, maxLength: 6 }), (parts) => {
        const text = parts.map(([n, op], i) => (i === parts.length - 1 ? `${n}` : `${n}${op}`)).join('');
        const parsed = parseExpression(syms(text));
        if (!parsed.ok) return false;
        const exact = evaluateExpr(parsed.expr).toNumber();
        const toks = text.split(/([+\-×])/).filter(Boolean);
        const out: number[] = [];
        const ops: string[] = [];
        const apply = () => {
          const b = out.pop()!, a = out.pop()!, o = ops.pop()!;
          out.push(o === '+' ? a + b : o === '-' ? a - b : a * b);
        };
        for (const tk of toks) {
          if (/\d/.test(tk)) out.push(Number(tk));
          else {
            while (ops.length && prec(ops[ops.length - 1]!) >= prec(tk)) apply();
            ops.push(tk);
          }
        }
        while (ops.length) apply();
        return Math.abs(exact - out[0]!) <= 1e-9 * Math.max(1, Math.abs(out[0]!));
      }),
      { numRuns: 1000 },
    );
  });
});
