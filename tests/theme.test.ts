// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readPalette } from '../src/render/theme';

describe('palette', () => {
  it('falls back to the right theme colors when the css is not loaded yet', () => {
    document.documentElement.dataset.theme = 'dark';
    expect(readPalette().ink.graphite).toBe('#ece8df');
    expect(readPalette().answer).toBe('#45d3bd');
    document.documentElement.dataset.theme = 'light';
    expect(readPalette().ink.graphite).toBe('#23262d');
  });
});
