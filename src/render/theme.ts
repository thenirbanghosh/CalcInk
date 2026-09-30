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

export function readPalette(el: HTMLElement = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    ink: { graphite: v('--ink-graphite'), blue: v('--ink-blue'), red: v('--ink-red') },
    answer: v('--answer'),
    good: v('--answer-good'),
    bad: v('--answer-bad'),
    muted: v('--muted'),
    xray: v('--xray'),
    xrayText: v('--xray-text'),
    paper: v('--paper'),
  };
}
