# Evaluation

How well CalcInk reads real handwriting and how fast it is. Everything here can be reproduced with `npm run eval` and `npm run test:e2e`.

## Data

We used [MathWriting](https://github.com/google-research/google-research/tree/master/mathwriting) (Google, 2024, CC BY-NC-SA 4.0). It's online handwritten math, meaning stroke coordinates, which is exactly what CalcInk gets from the pen. It was written by a lot of different people on different devices, and neither of our models was trained on it. The dataset isn't included in the repo, the eval script reads a local copy.

We made three test sets from it, all run through the same code the browser uses (segmentation, rasterizer, decoder and the same ONNX files, through onnxruntime-node):

| Set | What it is | Held-out size |
|---|---|---|
| isolated | single handwritten symbols from the dataset's `symbols` folder, all 16 CalcInk symbols | 219 |
| real | every human-written expression in train/valid/test whose label only uses CalcInk's symbols | 218 |
| stitched | 1000 random calculations (2-4 terms, 1-3 digit numbers, decimals, negatives, ending in `=`) built from real handwritten symbols with random size, spacing and baseline wobble | 1000 |

### Dev and held-out halves

We didn't train anything, but we did pick settings (ensemble weight, temperature, MNIST preprocessing, grouping thresholds). Those were all picked on a dev half: MathWriting `valid` plus the train and symbol files with an even hash of their file name. The numbers below are from the held-out half (`test` plus odd-hashed train and symbol files), which we only used for reporting.

### Metrics

- Symbols correct: 1 minus edit distance divided by length.
- Exact: the whole line was read correctly.
- Right answer: the calculator's result for what we read is the same as for the true label (same value, same tick/cross, both Undefined, etc).

## Results (held-out)

| Set | Symbols correct | Exact | Right answer |
|---|---|---|---|
| isolated (219) | 94.1% | | |
| real (218) | 88.5% | 70.6% | 92.2% |
| real, only proper calculations (28) | | 67.9% | 67.9% |
| stitched (1000, 8-15 symbols each) | 93.4% | 52.9% | 55.1% |

A lot of the real set isn't calculations at all (`=`, `+++`, `---+`, `...9999=-1`). The "proper calculations" row only counts labels with an `=` that evaluate. The stitched exact rate is close to what you'd expect from per-symbol accuracy over long lines (0.934^10 is about 0.51), so most mistakes there are single digits and not grouping.

### Per symbol (isolated, held-out, in %)

| Symbol | n | symbol CNN only | final |
|---|---|---|---|
| 0 | 12 | 92 | 92 |
| 1 | 18 | 89 | 94 |
| 2 | 18 | 83 | 94 |
| 3 | 20 | 95 | 95 |
| 4 | 12 | 75 | 83 |
| 5 | 13 | 85 | 92 |
| 6 | 12 | 92 | 92 |
| 7 | 14 | 100 | 100 |
| 8 | 16 | 94 | 94 |
| 9 | 16 | 94 | 94 |
| + | 13 | 85 | 85 |
| - | 13 | 100 | 100 |
| × | 18 | 94 | 94 |
| ÷ | 12 | 100 | 100 |
| = | 12 | 100 | 100 |
| all | 219 | 91.8 | 94.1 |

The 13 remaining mistakes: 4 read as 6 or 9, + as 1 or 6, × as +, 1 as 9, 3 as 7, 5 as 4, 6 as 1, 8 as 9, 9 as 3, and 0 and 2 as =. The decimal point is decided from size within a line, so it isn't part of the isolated test.

## What each part added (held-out)

| Setup | isolated | real: symbols / exact / answer | stitched: symbols / exact |
|---|---|---|---|
| symbol CNN, first version of the decoder (T = 1) | 91.8% | 84.9% / 67.4% / 90.8% | 90.1% / 37.2% |
| + temperature 2, full grammar on both sides of `=` | 91.8% | 85.5% / 67.4% / 91.7% | 91.1% / 39.7% |
| + MNIST digit model (alpha = 0.6) | 93.6% | 89.0% / 72.0% / 92.2% | 93.2% / 52.0% |
| + shear test-time augmentation (current) | 94.1% | 88.5% / 70.6% / 92.2% | 93.4% / 52.9% |

The last step is slightly worse on real exact (3 expressions out of 218) and better everywhere else. We kept it because it was clearly better on the dev half, and a difference of 3 out of 218 is within noise.

Before these model changes, work on grouping and decoding (tilted `=`, 5 hats, crossing strokes, size-relative line finding, the editing rule in the grammar) took the dev half's real exact rate from 73.8% to 80.1%.

## Settings we tried (dev half only)

Temperature, full pipeline:

| T | real symbols / exact / answer | stitched symbols / exact |
|---|---|---|
| 1 | 90.3% / 80.5% / 94.6% | 89.1% / 36.1% |
| 1.5 | 90.8% / 80.5% / 94.6% | 89.3% / 36.9% |
| 2 | 90.9% / 80.5% / 94.6% | 90.5% / 39.5% |
| 3 | 91.2% / 81.4% / 93.7% | 91.2% / 42.0% |

We picked 2: the biggest stitched gain that didn't lose any right answers on real expressions.

Symbol CNN stroke width (isolated, dev): 3 px 89.9%, 3.5 88.6%, 4 88.6%, 4.6 87.7%, 5.2 87.3%, 6 86.8%, 7 88.6%. That's flat within noise (one glyph is 0.44%), so we kept 4.6 px, which is what we measured on the training images. Width and rotation/shear TTA on the symbol CNN didn't help.

MNIST (isolated digits, dev): center of mass alignment is worth 6-8 points (77-81% to 83-85%), 1.6 px lines were best, and inputs in [0, 1]. Ensemble weight: 0.3 87.3%, 0.4 86.7%, 0.5 88.0%, 0.6 88.7%, 0.7 88.7%. Shear TTA (plus and minus 0.2): 88.7% to 90.0% on dev, 94.0% to 94.7% held out.

## Common mistakes (held-out real set)

1. One digit wrong in a long number, e.g. `264-175-365-4+5` read as `264-175-365-4+9`. This expression shows up many times in the dataset, and 5 to 9 and 4 to 1/6 are the most common.
2. A 4 written as two strokes with a gap between them gets read as 11 or 61, since nothing ties the two strokes together.
3. A `+` with a very low bar gets read as 1. The layout prior helps when there are enough digits on the line to know where the baseline is.
4. Things that aren't calculations (`3=1+1+1`, `+...+`), included because the filter only checks the symbols.

All of these can be fixed in one tap from the inspector, which shows each symbol's confidence and alternatives.

## Speed and memory

| What | Result | How |
|---|---|---|
| Frame rate while writing and recognizing | 60 fps, p95 16.7 ms, worst 16.8 ms | rAF intervals over 1650 frames while writing 6 expressions (`e2e/performance.spec.ts`) |
| Long tasks (over 50 ms) on the main thread | 0 | PerformanceObserver |
| Model load (both, first time) | 0.3-0.5 s | worker `ready` message |
| New 11-stroke line | about 100 ms in the worker (about 85 ms inference) | pipeline stats |
| Pen up to answer | about 0.4 s (280 ms pause + recognition) | client timing |
| Per expression in Node, 1 thread | median 8.8 ms, p95 62 ms (real), median 42 ms (stitched) | `npm run eval` |
| Heap over 12 write/undo/redo/clear rounds | 9.54 MB before and after | CDP GC + `performance.memory` |

In headless Chrome there's one ~50 ms hitch on the very first stroke after the page loads, with none of our code on the stack (it's the software compositor). The performance test draws one warm-up stroke first and then measures.

## Reproduce

```bash
# 1. Download MathWriting (2.9 GB) and list the arithmetic-only expressions
curl -LO https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz
tar xzf mathwriting-2024.tgz --exclude='*/synthetic/*'
cd mathwriting-2024
for d in test valid train; do grep -rlE '<annotation type="normalizedLabel">([0-9+=.-]|\\times|\\div)+</annotation>' $d > ../arith_$d.txt; done
cd -

# 2. Run the evaluation (held-out by default, --split dev for the dev half)
npm run eval -- --data /path/to/mathwriting-2024 --out docs/eval
npm run eval -- --data /path/to/mathwriting-2024 --digits off      # symbol CNN only

# 3. pix2text comparison (Python + onnxruntime, see MODEL.md)
MATHWRITING=/path/to/mathwriting-2024 python scripts/eval/compare_pix2text.py
```

Raw output: [`eval/results-heldout.json`](eval/results-heldout.json), [`results-heldout-cnn-only.json`](eval/results-heldout-cnn-only.json), [`results-dev.json`](eval/results-dev.json), [`pix2text-heldout.json`](eval/pix2text-heldout.json).
