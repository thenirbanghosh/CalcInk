# Model choice

We needed something that could read handwritten `0-9 + - × ÷ . =` in the browser, offline, using an existing pre-trained open-source model, without making the pen lag. This is what we looked at, what we measured, and why we ended up with two small models.

No training or fine-tuning happens in this project. Every number here comes from the published weights.

## What we needed

| Need | Why |
|---|---|
| All 15 learned symbols (`0-9 + - × ÷ =`) | Most handwriting models only do the 10 MNIST digits. |
| Small and fast | It ships with the site, gets cached for offline use and runs on every edit, also on phones. A line should be done well within the 280 ms pause after pen up. |
| Per-symbol output | We place the answer right after the `=` and let users fix individual symbols. Image-to-LaTeX models only give a string with no positions. |
| Permissive license | The repo is public. Non-commercial weights are a problem. |
| Runs in a browser | ONNX Runtime Web or TF.js. |

The decimal point isn't on the list on purpose. After the crop-and-scale preprocessing a dot is just a blob, so we detect it from its size instead.

## Candidates

| Model | Output | Size | License | Result |
|---|---|---|---|---|
| Symbol CNN, [altynbk/handwritten-math-recognition](https://github.com/altynbk/handwritten-math-recognition) `cnn_aug` | 15 classes `0-9 + - × ÷ =` | 1.58 MB, 393k params | MIT | used (main model) |
| MNIST-12, [ONNX Model Zoo](https://github.com/onnx/models/tree/main/validated/vision/classification/mnist) | 10 digits | 26 KB, 6k params | MIT | used (digit model) |
| pix2text-MFR, [breezedeus/pix2text-mfr](https://huggingface.co/breezedeus/pix2text-mfr) | LaTeX string (TrOCR, DeiT encoder + decoder) | 118 MB | MIT | tested, 19.7% exact vs our 70.6%, no symbol positions |
| TrOCR-Math, [fhswf/TrOCR_Math_handwritten](https://huggingface.co/fhswf/TrOCR_Math_handwritten) | LaTeX string | 0.6B params, 2.4 GB | AFL-3.0 | too big for a web page |
| LaTeXVision, [ryanwhitford/LaTeXVision](https://github.com/ryanwhitford/LaTeXVision) | LaTeX string | 4.4M params (~100 MB archive) | weights CC BY-NC-SA | non-commercial license, 51% exact reported on human writing, meant to run on a server |
| HOG + linear SVM (same repo as the symbol CNN) | 15 classes | 0.2 MB | MIT | not a neural network, 96.4% vs 99.4% on the author's test set |
| `cnn_real` (same repo, trained without augmentation) | 15 classes | 1.6 MB | MIT | drops to 71% on the author's perturbed test set vs 98.5% for `cnn_aug` |

### pix2text-MFR vs our pipeline

pix2text-MFR was the strongest alternative that could run in a browser (MIT, ONNX available), so we ran it on the same 218 held-out human expressions we use for our own numbers (`scripts/eval/compare_pix2text.py`). Each ink was drawn black on white and preprocessed like its `TrOCRProcessor`, with greedy decoding.

| | CalcInk | pix2text-MFR |
|---|---|---|
| Exact, all 218 | 70.6% | 19.7% |
| Exact, 4+ symbols (91) | 47.3% | 42.9% |
| Model size | 1.6 MB | 118 MB |
| Time per expression | ~8 ms in Node (single thread), ~100 ms in the browser worker including segmentation | 134 ms median, native multi-threaded |
| Symbol positions | yes | no |
| Vocabulary | only arithmetic | any LaTeX, so it sometimes outputs things like `\smile` for a 3 |

It gets closer on long expressions, but it's 73 times bigger, slower in WASM, can't tell us where the `=` is, and makes up symbols a calculator can't use.

## Why two models

On MathWriting single symbols (handwriting from people neither model has seen) the symbol CNN is good at operators but weaker at digits, because it learned from 8,036 images by a small number of people. MNIST only knows digits but learned from 60,000 digits by about 250 writers. Digit accuracy on isolated MathWriting digits:

| | dev half | held-out half |
|---|---|---|
| symbol CNN only | 82.0% | 91.4% |
| MNIST only | 85.3% | 92.1% |
| combined (alpha = 0.6) | 88.7% | 94.0% |

The combination keeps MNIST from ever turning an operator into a digit:

```
P(any digit)  = from the symbol CNN only
P(d | digit)  proportional to p_cnn(d | digit)^0.6 * p_mnist(d)^0.4
P(operator)   = symbol CNN, unchanged
```

0.6 was the best weight on the dev half, and the held-out half showed the same improvement.

## Where the files come from

`scripts/model/build_models.py` rebuilds both files from the original sources and won't write them unless the checks pass.

symbols-cnn.onnx
- Source: `models/cnn_aug.keras` at commit `3d91c0c503a596b4efbf35da36cf00e931cc0928`.
- Converted with tf2onnx (opset 17). Input `[N, 64, 64, 1]` named `input`, output renamed to `probs`.
- Checks: max difference between Keras and ONNX on the upstream test split is 1.1e-6, and the ONNX model scores 99.44% on it, same as the published number.
- Architecture: 4 x (3x3 conv + ReLU, batch norm, 2x2 max pool) with 32/64/128/256 filters, global average pooling, dropout 0.5, dense(15) softmax. Classes in folder order `0-9, add, div, eq, mul, sub`.

digits-mnist.onnx
- Source: `mnist-12.onnx` from the ONNX Model Zoo (trained with CNTK, MIT).
- The reshape `[1, 256]` was changed to `[-1, 256]` so it takes batches, I/O renamed to `image` / `logits`, old shape info removed. Output is identical to the original (max diff 1.3e-6) on random inputs.
- Architecture: 5x5 conv (8) + ReLU + 2x2 max pool, 5x5 conv (16) + ReLU + 3x3 max pool, dense(256 to 10).

## Matching the training preprocessing

Getting the preprocessing exactly right mattered more than anything else. We draw the input from the stroke points (`src/recognition/rasterize.ts`):

| | Symbol CNN | MNIST-12 |
|---|---|---|
| Size | 64 x 64, light on dark | 28 x 28, light on dark |
| Fit | bounding box padded to a square with 15% margin per side (same as the upstream `crop_to_content`) | longest side 20 px |
| Center | bounding box center | center of mass at (14, 14) |
| Line width | 4.6 px (median width in the training images, measured with a distance transform) | 1.6 px (best of 1.6-3.4 on dev) |
| Test-time augmentation | none (didn't help on dev) | 3 shears, k in {-0.2, 0, 0.2}, log probs averaged |

Center of mass alignment alone was worth 6-8 points for MNIST on the dev set.

## Calibration

On handwriting that looks different from its training data, the symbol CNN is overconfident and often outputs 1.00 for a wrong class. That leaves the decoder's geometry and grammar nothing to work with. We apply temperature 2 before decoding (best of 1, 1.5, 2 and 3 on dev, see EVALUATION.md).

## Runtime

ONNX Runtime Web 1.30, WASM SIMD backend, one thread, in a dedicated worker.

- CPU instead of WebGL/WebGPU, because the GPU is busy compositing the canvases and the pen depends on that. These models only take a few ms per symbol on the CPU anyway.
- One thread, because multi-threaded WASM needs SharedArrayBuffer, which needs COOP/COEP headers that GitHub Pages can't send.
- The 14 MB `.wasm` file is bundled and passed to `env.wasm.wasmPaths`, so it never falls back to a CDN and airplane mode works.
- Models are fetched once, created with full graph optimization, warmed up with a dummy batch, and tensors are disposed after every run.

## Limitations

- Weakest symbols on unseen writers: `4` (83%), `+` (85%), `1`/`2`/`5` (92-94%). Typical mistakes are `4` read as 6 or 9 and a `+` with a low bar read as 1. The layout prior and decoder fix many of these in context, and the inspector lets you fix the rest.
- No parentheses, powers or letters, since neither model knows them. A HASYv2-trained model would be the next thing to try.
