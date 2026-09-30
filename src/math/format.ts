import type { Rational } from './rational';

export interface FormattedNumber {
  text: string;
  negative: boolean;
  intPart: string;
  fixed: string;
  repeat: string;
  rounded: boolean;
  exponent?: number;
  fraction: string | null;
}

export interface FormatOptions {
  maxFractionDigits?: number;
  maxIntegerDigits?: number;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

export function formatRational(r: Rational, opts: FormatOptions = {}): FormattedNumber {
  const maxFrac = opts.maxFractionDigits ?? 10;
  const maxInt = opts.maxIntegerDigits ?? 15;
  const negative = r.n < 0n;
  const n = abs(r.n);
  const d = r.d;
  const fraction = d === 1n ? null : `${negative ? '-' : ''}${n}/${d}`;

  const intPart = (n / d).toString();
  const tooBig = intPart.length > maxInt;
  const tooSmall = n !== 0n && n * 10n ** 6n < d; // |x| < 1e-6
  if (tooBig || tooSmall) return scientific(n, d, negative, fraction);

  let rem = n % d;
  const digits: string[] = [];
  // long division. if a remainder repeats, the digits repeat from there
  const seen = new Map<bigint, number>();
  while (rem !== 0n && digits.length < maxFrac) {
    if (seen.has(rem)) break;
    seen.set(rem, digits.length);
    rem *= 10n;
    digits.push((rem / d).toString());
    rem %= d;
  }

  if (rem === 0n) return build(negative, intPart, digits.join(''), '', false, fraction);
  const cycleStart = seen.get(rem);
  if (cycleStart !== undefined) {
    return build(negative, intPart, digits.slice(0, cycleStart).join(''), digits.slice(cycleStart).join(''), false, fraction);
  }

  const scale = 10n ** BigInt(maxFrac);
  const q = (n * scale * 2n + d) / (2n * d);
  const whole = (q / scale).toString();
  const frac = (q % scale).toString().padStart(maxFrac, '0').replace(/0+$/, '');
  return build(negative, whole, frac, '', true, fraction);
}

function build(negative: boolean, intPart: string, fixed: string, repeat: string, rounded: boolean, fraction: string | null): FormattedNumber {
  const isZero = intPart === '0' && fixed === '' && repeat === '';
  const neg = negative && !isZero;
  let text = (neg ? '-' : '') + intPart;
  if (fixed || repeat) text += '.' + fixed + (repeat ? `(${repeat})` : '');
  if (rounded) text += '…';
  return { text, negative: neg, intPart, fixed, repeat, rounded, fraction };
}

function scientific(n: bigint, d: bigint, negative: boolean, fraction: string | null): FormattedNumber {
  const SIG = 8;
  let exp = n.toString().length - d.toString().length;
  const ge = (e: number) => (e >= 0 ? n >= d * 10n ** BigInt(e) : n * 10n ** BigInt(-e) >= d);
  if (!ge(exp)) exp--;
  if (ge(exp + 1)) exp++;
  const shift = SIG - 1 - exp;
  const num = shift >= 0 ? n * 10n ** BigInt(shift) : n;
  const den = shift >= 0 ? d : d * 10n ** BigInt(-shift);
  let m = (num * 2n + den) / (2n * den);
  if (m.toString().length > SIG) {
    m /= 10n;
    exp++;
  }
  const ms = m.toString();
  const intPart = ms[0]!;
  const fixed = ms.slice(1).replace(/0+$/, '');
  const text = `${negative ? '-' : ''}${intPart}${fixed ? '.' + fixed : ''}e${exp >= 0 ? '+' : ''}${exp}`;
  return { text, negative, intPart, fixed, repeat: '', rounded: true, exponent: exp, fraction };
}
