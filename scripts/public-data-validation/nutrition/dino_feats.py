# DINOv2-small (int8 ONNX) embeddings for the same Open Images and Bangladeshi photos, with the app's
# crop (centre 80% square, 224 x 224) and ImageNet mean/std. Embedding = [CLS token, mean of patch
# tokens], L2-normalised. Used only to compare backbones against EfficientNetV2-B0.
import json, sys, numpy as np, onnxruntime as ort
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
M = '/mnt/user-data/uploads/datasets/dinov2-small/model_quantized.onnx'
so = ort.SessionOptions(); so.intra_op_num_threads = 4; s = ort.InferenceSession(M, so)
mean = np.array([0.485, 0.456, 0.406], np.float32); std = np.array([0.229, 0.224, 0.225], np.float32)
def prep(p, flip=False):
    im = Image.open(p); im.seek(0); im = im.convert('RGB'); W, H = im.size; sd = round(min(W, H) * 0.8); x = round((W - sd) / 2); y = round((H - sd) / 2)
    im = im.crop((x, y, x + sd, y + sd)).resize((224, 224), Image.BILINEAR)
    if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)
    a = (np.asarray(im, np.float32) / 255 - mean) / std
    return a.transpose(2, 0, 1)
def embed(paths, flip=False):
    out = []
    with ThreadPoolExecutor(4) as ex:
        for i in range(0, len(paths), 16):
            x = np.stack(list(ex.map(lambda p: prep(p, flip), paths[i:i + 16])))
            h = s.run(None, {'pixel_values': x})[0]
            out.append(np.concatenate([h[:, 0], h[:, 1:].mean(1)], 1))
            if i % 1600 == 0: print(i, flush=True)
    E = np.concatenate(out); return (E / np.linalg.norm(E, axis=1, keepdims=True)).astype(np.float32)
meta = json.load(open('/tmp/w/nut/cls_effl0.json')); bd = json.load(open('/tmp/w/nut/bd/bd_meta.json'))
np.save('/tmp/w/nut/dino/emb_bd.npy', embed([b['path'] for b in bd]))
np.save('/tmp/w/nut/dino/emb_oi.npy', embed([f"/tmp/w/nut/img/{m['key']}.jpg" for m in meta]))
print('done')
