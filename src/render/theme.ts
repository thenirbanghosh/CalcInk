import type { InkColor } from '../core/strokes';

export interface Palette {
  ink: Record<InkColor, string>;
  answer: string;
  good: string;
  bad: string;
  muted: string;
  xray: string;
  xrayText: string;
  paper: string;
}

// same values as styles.css. used when the stylesheet hasn't applied yet
// (safari can run the module before the css is in), otherwise ink ends up black
const FALLBACK: Record<'light' | 'dark', Palette> = {
  light: {
    ink: { graphite: '#23262d', blue: '#2446c7', red: '#c8372d' },
    answer: '#0c8574', good: '#2f9e44', bad: '#d9363e', muted: '#8a8f98',
    xray: '#7048e8', xrayText: '#ffffff', paper: '#fbf8f1',
  },
  dark: {
    ink: { graphite: '#ece8df', blue: '#86a8ff', red: '#ff8f85' },
    answer: '#45d3bd', good: '#6fdc8c', bad: '#ff6b72', muted: '#8b929c',
    xray: '#b39cff', xrayText: '#16181c', paper: '#1b1e23',
  },
};

export function readPalette(el: HTMLElement = document.documentElement): Palette {
  const fb = FALLBACK[el.dataset.theme === 'dark' ? 'dark' : 'light'];
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: { graphite: v('--ink-graphite', fb.ink.graphite), blue: v('--ink-blue', fb.ink.blue), red: v('--ink-red', fb.ink.red) },
    answer: v('--answer', fb.answer),
    good: v('--answer-good', fb.good),
    bad: v('--answer-bad', fb.bad),
    muted: v('--muted', fb.muted),
    xray: v('--xray', fb.xray),
    xrayText: v('--xray-text', fb.xrayText),
    paper: v('--paper', fb.paper),
  };
}
