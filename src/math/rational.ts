function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export class DivisionByZeroError extends Error {
  constructor() {
    super('division by zero');
    this.name = 'DivisionByZeroError';
  }
}

export class Rational {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    this.n = n;
    this.d = d;
  }

  static readonly ZERO = new Rational(0n, 1n);
  static readonly ONE = new Rational(1n, 1n);

  static of(n: bigint | number, d: bigint | number = 1n): Rational {
    let nn = BigInt(n);
    let dd = BigInt(d);
    if (dd === 0n) throw new DivisionByZeroError();
    if (dd < 0n) {
      nn = -nn;
      dd = -dd;
    }
    const g = gcd(nn, dd);
    return g > 1n ? new Rational(nn / g, dd / g) : new Rational(nn, dd);
  }

  static parseDecimal(text: string): Rational | null {
    const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!m) return null;
    const intPart = m[1] ?? '';
    const fracPart = m[2] ?? '';
    if (intPart === '' && fracPart === '') return null;
    const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
    return Rational.of(BigInt(digits), 10n ** BigInt(fracPart.length));
  }

  add(o: Rational): Rational {
    return Rational.of(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o: Rational): Rational {
    return Rational.of(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o: Rational): Rational {
    return Rational.of(this.n * o.n, this.d * o.d);
  }

  div(o: Rational): Rational {
    if (o.n === 0n) throw new DivisionByZeroError();
    return Rational.of(this.n * o.d, this.d * o.n);
  }

  neg(): Rational {
    return new Rational(-this.n, this.d);
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  isInteger(): boolean {
    return this.d === 1n;
  }

  sign(): -1 | 0 | 1 {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }

  equals(o: Rational): boolean {
    return this.n === o.n && this.d === o.d;
  }

  toNumber(): number {
    const n = this.n;
    const d = this.d;
    const bits = Math.max(n.toString(2).length, d.toString(2).length) - 1000;
    if (bits > 0) {
      const s = BigInt(bits);
      return Number(n >> s) / Number(d >> s);
    }
    return Number(n) / Number(d);
  }

  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }
}
