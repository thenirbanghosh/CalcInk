"""
Runs pix2text-mfr (huggingface breezedeus/pix2text-mfr, TrOCR, ~118 MB onnx) on the
same held-out MathWriting arithmetic expressions we report in docs/EVALUATION.md,
to compare against our pipeline.

Each ink is drawn black on white and preprocessed like its TrOCRProcessor
(384x384, mean/std 0.5), then decoded greedily.

usage: put encoder_model.onnx, decoder_model.onnx and tokenizer.json from the HF repo
in the current folder, then
  MATHWRITING=/path/to/mathwriting-2024 python compare_pix2text.py
"""
import json, re, os, sys, time
import numpy as np, onnxruntime as ort
from PIL import Image, ImageDraw

DATA = os.environ.get('MATHWRITING', os.path.expanduser('~/mathwriting-2024'))
def jhash(s):
    h = 7
    for ch in s: h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h
def heldout(split, fid):
    dev = split == 'valid' or (split == 'train' and jhash(fid) % 2 == 0)
    return not dev
def read(path):
    x = open(path).read()
    lab = re.search(r'<annotation type="normalizedLabel">([^<]*)</annotation>', x).group(1)
    strokes = [np.array([[float(v) for v in p.split()[:2]] for p in t.strip().split(',')]) for t in re.findall(r'<trace[^>]*>([^<]*)</trace>', x)]
    return lab, strokes
def to_syms(s):
    s = s.replace(' ', '').replace('\\times', '×').replace('\\div', '÷').replace('\\cdot', '×').replace('{', '').replace('}', '')
    return s
def render(strokes):
    allp = np.concatenate(strokes); mn, mx = allp.min(0), allp.max(0)
    h = max(mx[1] - mn[1], 1); w = max(mx[0] - mn[0], 1)
    scale = 96 / h  # ~96 px tall writing
    pad = 16
    W, H = int(w * scale) + 2 * pad, int(h * scale) + 2 * pad
    img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    lw = max(2, int(round(96 * 0.035)))
    for s in strokes:
        pts = [((p[0] - mn[0]) * scale + pad, (p[1] - mn[1]) * scale + pad) for p in s]
        if len(pts) == 1: d.ellipse([pts[0][0]-lw, pts[0][1]-lw, pts[0][0]+lw, pts[0][1]+lw], fill='black')
        else: d.line(pts, fill='black', width=lw, joint='curve')
    return img
tok = json.load(open('tokenizer.json')); inv = {v: k for k, v in tok['model']['vocab'].items()}
enc = ort.InferenceSession('encoder_model.onnx', providers=['CPUExecutionProvider'])
dec = ort.InferenceSession('decoder_model.onnx', providers=['CPUExecutionProvider'])
def recognize(img):
    x = np.asarray(img.resize((384, 384), Image.BICUBIC), dtype=np.float32) / 255.0
    x = ((x - 0.5) / 0.5).transpose(2, 0, 1)[None]
    hs = enc.run(None, {'pixel_values': x})[0]
    ids = [2]
    for _ in range(80):
        logits = dec.run(None, {'input_ids': np.array([ids], dtype=np.int64), 'encoder_hidden_states': hs})[0]
        nxt = int(logits[0, -1].argmax())
        if nxt == 2: break
        ids.append(nxt)
    text = ''.join(inv.get(i, '') for i in ids[1:]).replace('Ġ', ' ')
    return text.strip()
items = []
for split in ['train', 'valid', 'test']:
    for rel in open(os.path.join(DATA, f'../arith_{split}.txt')).read().split():
        fid = rel.split('/')[-1]
        if heldout(split, fid): items.append(os.path.join(DATA, rel))
n = exact = 0; times = []; fails = []
for p in items:
    lab, strokes = read(p)
    truth = to_syms(lab)
    t = time.perf_counter(); out = recognize(render(strokes)); times.append(time.perf_counter() - t)
    got = to_syms(out)
    n += 1; exact += got == truth
    if got != truth and len(fails) < 25: fails.append((truth, out))
print(json.dumps({'n': n, 'exact': exact / n, 'p50_ms': 1000 * float(np.median(times)), 'p95_ms': 1000 * float(np.percentile(times, 95))}))
for f in fails: print(f)
