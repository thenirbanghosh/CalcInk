import * as ort from 'onnxruntime-node';
import { DIGITS_MODEL, SYMBOLS_MODEL } from '../../src/recognition/model';
import type { ClassifyBatch, DigitBatch } from '../../src/recognition/pipeline';

const opts = { intraOpNumThreads: 1, interOpNumThreads: 1 };

export async function nodeClassifier(modelPath = 'public/' + SYMBOLS_MODEL.file): Promise<{ classify: ClassifyBatch; session: ort.InferenceSession }> {
  const session = await ort.InferenceSession.create(modelPath, opts);
  const S = SYMBOLS_MODEL.size;
  const classify: ClassifyBatch = async (input, count) => {
    const tensor = new ort.Tensor('float32', input.subarray(0, count * S * S), [count, S, S, 1]);
    const res = await session.run({ [SYMBOLS_MODEL.input]: tensor });
    return res[SYMBOLS_MODEL.output]!.data as Float32Array;
  };
  return { classify, session };
}

export async function nodeDigitExpert(modelPath = 'public/' + DIGITS_MODEL.file): Promise<DigitBatch> {
  const session = await ort.InferenceSession.create(modelPath, opts);
  const S = DIGITS_MODEL.size;
  return async (input, count) => {
    const tensor = new ort.Tensor('float32', input.subarray(0, count * S * S), [count, 1, S, S]);
    const res = await session.run({ [DIGITS_MODEL.input]: tensor });
    return res[DIGITS_MODEL.output]!.data as Float32Array;
  };
}
