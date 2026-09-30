"""
Builds the two model files in public/models from the original releases (no training).

symbols-cnn.onnx: cnn_aug.keras from github.com/altynbk/handwritten-math-recognition
(commit 3d91c0c), converted with tf2onnx. Checks that the onnx output matches keras
and that it still gets 99.44% on the author's test split.

digits-mnist.onnx: mnist-12.onnx from the ONNX model zoo. Only change is the reshape
so it accepts a batch, checked against the original.

setup (python 3.11):
  python -m venv .venv
  .venv/bin/pip install tensorflow tf2onnx onnx onnxruntime opencv-python-headless scikit-learn pillow
  .venv/bin/python scripts/model/build_models.py --work /tmp/calcink-models --out public/models
"""
import argparse, hashlib, os, subprocess, sys, urllib.request
import numpy as np

UPSTREAM = "https://github.com/altynbk/handwritten-math-recognition.git"
UPSTREAM_COMMIT = "3d91c0c503a596b4efbf35da36cf00e931cc0928"
MNIST_URL = "https://github.com/onnx/models/raw/main/validated/vision/classification/mnist/model/mnist-12.onnx"


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def build_symbols(work, out):
    import onnx, onnxruntime as ort
    repo = os.path.join(work, "handwritten-math-recognition")
    if not os.path.isdir(repo):
        subprocess.check_call(["git", "clone", "-q", UPSTREAM, repo])
    subprocess.check_call(["git", "-C", repo, "checkout", "-q", UPSTREAM_COMMIT])
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    import tensorflow as tf, keras, tf2onnx
    sys.path.insert(0, repo)
    from src.data import load_dataset, split_data  # upstream code, unmodified

    model = keras.models.load_model(os.path.join(repo, "models/cnn_aug.keras"))
    spec = (tf.TensorSpec((None, 64, 64, 1), tf.float32, name="input"),)
    proto, _ = tf2onnx.convert.from_keras(model, input_signature=spec, opset=17)
    old_out = proto.graph.output[0].name
    for node in proto.graph.node:
        node.output[:] = ["probs" if o == old_out else o for o in node.output]
    proto.graph.output[0].name = "probs"
    proto.doc_string = ("CalcInk symbol classifier. Upstream: altynbk/handwritten-math-recognition "
                        f"@{UPSTREAM_COMMIT[:7]} (MIT). Labels: 0-9, add, div, eq, mul, sub. Input NHWC [N,64,64,1] in [0,1], light ink on dark.")
    dst = os.path.join(out, "symbols-cnn.onnx")
    onnx.save(proto, dst)

    X, y, names, _ = load_dataset(os.path.join(repo, "data/handwritten_dataset"))
    Xte, yte = split_data(X, y, seed=42)["test"]
    pk = model.predict(Xte, verbose=0)
    po = ort.InferenceSession(dst).run(None, {"input": Xte})[0]
    diff = float(np.abs(pk - po).max())
    acc = float((po.argmax(1) == yte).mean())
    print(f"symbols-cnn: max|keras-onnx|={diff:.2e}  test acc={acc:.4f} (published 0.9944)  sha256={sha256(dst)[:16]}")
    assert diff < 1e-4 and abs(acc - 0.9944) < 1e-3


def build_mnist(work, out):
    import onnx, onnxruntime as ort
    from onnx import numpy_helper
    src = os.path.join(work, "mnist-12.onnx")
    if not os.path.exists(src):
        urllib.request.urlretrieve(MNIST_URL, src)
    m = onnx.load(src)
    for init in m.graph.initializer:
        if init.name == "Pooling160_Output_0_reshape0_shape":
            init.CopyFrom(numpy_helper.from_array(np.array([-1, 256], dtype=np.int64), init.name))
    m.graph.input[0].type.tensor_type.shape.dim[0].dim_param = "N"
    m.graph.output[0].type.tensor_type.shape.dim[0].dim_param = "N"
    for node in m.graph.node:
        node.input[:] = ["image" if i == "Input3" else i for i in node.input]
        node.output[:] = ["logits" if o == "Plus214_Output_0" else o for o in node.output]
    m.graph.input[0].name = "image"
    del m.graph.value_info[:]  # stale batch-1 shape annotations
    m.graph.output[0].name = "logits"
    m.doc_string = "MNIST-12 (ONNX Model Zoo, MIT), patched for dynamic batch. Input NCHW [N,1,28,28] in [0,1], white digit on black; output logits over 0-9."
    onnx.checker.check_model(m)
    dst = os.path.join(out, "digits-mnist.onnx")
    onnx.save(m, dst)
    rng = np.random.default_rng(0)
    xs = rng.random((8, 1, 28, 28), dtype=np.float32)
    a = np.concatenate([ort.InferenceSession(src).run(None, {"Input3": xs[i:i + 1]})[0] for i in range(8)])
    b = ort.InferenceSession(dst).run(None, {"image": xs})[0]
    diff = float(np.abs(a - b).max())
    print(f"digits-mnist: batched vs original max diff={diff:.2e}  sha256={sha256(dst)[:16]}")
    assert diff < 1e-5


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/calcink-models")
    ap.add_argument("--out", default="public/models")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    build_symbols(a.work, a.out)
    build_mnist(a.work, a.out)
