export const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export const OPERATORS = ['+', '-', '×', '÷'] as const;

export type Digit = (typeof DIGITS)[number];
export type Operator = (typeof OPERATORS)[number];
export type Sym = Digit | Operator | '.' | '=';

export const ALL_SYMBOLS: readonly Sym[] = [...DIGITS, ...OPERATORS, '.', '='];

export function isDigit(s: string): s is Digit {
  return s.length === 1 && s >= '0' && s <= '9';
}

export function isOperator(s: string): s is Operator {
  return s === '+' || s === '-' || s === '×' || s === '÷';
}

export function displaySymbol(s: Sym): string {
  return s === '-' ? '−' : s;
}

export function formatExpression(symbols: readonly Sym[]): string {
  let out = '';
  symbols.forEach((s, i) => {
    const prev = symbols[i - 1];
    const unary = s === '-' && (prev === undefined || isOperator(prev) || prev === '=');
    if ((isOperator(s) && !unary) || s === '=') out += ` ${displaySymbol(s)} `;
    else out += displaySymbol(s);
  });
  return out.replace(/\s+/g, ' ').trim();
}
