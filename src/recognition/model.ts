import type { Sym } from '../math/tokens';

// output order of the symbol model (folder names sorted: 0-9 add div eq mul sub)
export const MODEL_LABELS: readonly Sym[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '÷', '=', '×', '-'];

export const SYMBOLS_MODEL = {
  file: 'models/symbols-cnn.onnx',
  input: 'input',
  output: 'probs',
  size: 64,
  margin: 0.15,
  // median stroke width in the training images
  strokeWidth: 4.6,
} as const;

export const DIGITS_MODEL = {
  file: 'models/digits-mnist.onnx',
  input: 'image',
  output: 'logits',
  size: 28,
  margin: 0.2,
  strokeWidth: 1.6,
} as const;

// weight of the symbol model vs mnist for digits, picked on the dev split
export const DIGIT_ENSEMBLE_ALPHA = 0.6;

// the CNN is overconfident on handwriting it has not seen, soften it a bit
export const CALIBRATION_TEMPERATURE = 2;

export const DIGIT_TTA_SHEARS = [-0.2, 0, 0.2] as const;

export const INPUT_SIZE = SYMBOLS_MODEL.size;
export const CROP_MARGIN = SYMBOLS_MODEL.margin;
export const RASTER_STROKE_WIDTH = SYMBOLS_MODEL.strokeWidth;
export const INPUT_NAME = SYMBOLS_MODEL.input;
