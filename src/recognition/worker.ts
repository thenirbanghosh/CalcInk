/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { DIGITS_MODEL, SYMBOLS_MODEL } from './model';
import { RecognitionPipeline, type ClassifyBatch, type DigitBatch } from './pipeline';
import type { FromWorker, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let pipeline: RecognitionPipeline | null = null;
const pending: ToWorker[] = [];
let busy = false;

const post = (m: FromWorker) => self.postMessage(m);

async function init(baseUrl: string, wasmUrl: string): Promise<void> {
  const t0 = performance.now();
  // load the wasm from our own origin, no CDN, so it works offline
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';

  const load = async (file: string) => {
    const res = await fetch(new URL(file, baseUrl));
    if (!res.ok) throw new Error(`could not load ${file}: HTTP ${res.status}`);
    return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  };
  const [symbols, digits] = await Promise.all([load(SYMBOLS_MODEL.file), load(DIGITS_MODEL.file)]);

  const classify: ClassifyBatch = async (input, count) => {
    const S = SYMBOLS_MODEL.size;
    const t = new ort.Tensor('float32', input.subarray(0, count * S * S), [count, S, S, 1]);
    const out = await symbols.run({ [SYMBOLS_MODEL.input]: t });
    const data = (out[SYMBOLS_MODEL.output]!.data as Float32Array).slice();
    t.dispose();
    out[SYMBOLS_MODEL.output]!.dispose();
    return data;
  };
  const digitExpert: DigitBatch = async (input, count) => {
    const S = DIGITS_MODEL.size;
    const t = new ort.Tensor('float32', input.subarray(0, count * S * S), [count, 1, S, S]);
    const out = await digits.run({ [DIGITS_MODEL.input]: t });
    const data = (out[DIGITS_MODEL.output]!.data as Float32Array).slice();
    t.dispose();
    out[DIGITS_MODEL.output]!.dispose();
    return data;
  };

  pipeline = new RecognitionPipeline(classify, { digits: digitExpert });
  // warm up
  await classify(new Float32Array(SYMBOLS_MODEL.size ** 2), 1);
  await digitExpert(new Float32Array(DIGITS_MODEL.size ** 2), 1);
  post({ type: 'ready', loadMs: performance.now() - t0, backend: 'wasm-simd' });
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case 'init':
      await init(msg.baseUrl, msg.wasmUrl);
      return;
    case 'sync':
      pipeline?.remove(msg.removed);
      pipeline?.add(msg.added);
      return;
    case 'override':
      pipeline?.setOverride(msg.key, msg.label);
      return;
    case 'reset':
      pipeline?.clear();
      return;
    case 'recognize': {
      if (!pipeline) return;
      if (pending.some((m) => m.type === 'recognize')) return;
      const { lines, stats } = await pipeline.recognize();
      post({ type: 'result', requestId: msg.requestId, version: msg.version, lines, stats });
      return;
    }
  }
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (pending.length) {
      const msg = pending.shift()!;
      try {
        await handle(msg);
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    busy = false;
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  pending.push(e.data);
  void drain();
};
