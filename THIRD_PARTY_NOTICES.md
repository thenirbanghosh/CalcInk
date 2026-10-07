# Third-party notices

CalcInk is MIT licensed (see `LICENSE`). It uses the following.

## Models (in `public/models/`)

| File | Source | License |
|---|---|---|
| `symbols-cnn.onnx` | [altynbk/handwritten-math-recognition](https://github.com/altynbk/handwritten-math-recognition), `models/cnn_aug.keras` at `3d91c0c`, converted to ONNX | MIT, Copyright (c) 2026 Altynbek Kabiyev |
| `digits-mnist.onnx` | [ONNX Model Zoo, MNIST-12](https://github.com/onnx/models/tree/main/validated/vision/classification/mnist), batch dimension made dynamic | MIT (model card: `SPDX-License-Identifier: MIT`) |

## Libraries bundled in the app

| Package | License |
|---|---|
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) (JS + WebAssembly) | MIT, Microsoft Corporation |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | MIT, Stephen Ruiz |
| [workbox-window](https://github.com/GoogleChrome/workbox) (through vite-plugin-pwa) | MIT, Google LLC |

## Fonts (bundled)

| Font | Package | License |
|---|---|---|
| Caveat | `@fontsource/caveat` | SIL Open Font License 1.1 |
| Inter | `@fontsource-variable/inter` | SIL Open Font License 1.1 |

## Evaluation data (not included)

[MathWriting](https://github.com/google-research/google-research/tree/master/mathwriting) (Google, 2024) is only used by the evaluation script and isn't redistributed. License: CC BY-NC-SA 4.0.

## Dev tools

Vite, TypeScript, Vitest, fast-check, Playwright, tsx, onnxruntime-node (MIT / Apache-2.0), and tf2onnx and TensorFlow (Apache-2.0) for converting the model.
