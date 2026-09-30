let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// creating the AudioContext blocked for ~200ms on pen down, so create it while idle
// and just resume it on the first pointerup
export function primeAudio(): void {
  const create = () => {
    if (typeof AudioContext !== 'undefined') ctx ??= new AudioContext({ latencyHint: 'interactive' });
  };
  if ('requestIdleCallback' in window) requestIdleCallback(create, { timeout: 4000 });
  else setTimeout(create, 1500);
  const resume = () => {
    if (ctx?.state === 'suspended') void ctx.resume();
    if (ctx) window.removeEventListener('pointerup', resume);
  };
  window.addEventListener('pointerup', resume);
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playAnswer(): void {
  tone(1046.5, 0, 0.22, 0.05);
  tone(1567.98, 0.06, 0.3, 0.035);
}

export function playSoft(): void {
  tone(392, 0, 0.25, 0.04, 'triangle');
}

export function playSwish(): void {
  const a = audio();
  if (!a) return;
  const dur = 0.18;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2400;
  f.Q.value = 0.8;
  const g = a.createGain();
  g.gain.value = 0.12;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export function haptic(pattern: number | number[] = 8): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
  }
}
