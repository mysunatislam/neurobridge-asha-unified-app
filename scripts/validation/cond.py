# Per-image condition estimates: face brightness (lighting proxy) and Individual Typology Angle
# (ITA, a colorimetric skin-tone proxy) from cheek patches located by the face landmarks.
import json, sys, math, os
import numpy as np
from PIL import Image
src, listf, out = sys.argv[1], sys.argv[2], sys.argv[3]
def srgb_to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16; b = 200 * (f[..., 1] - f[..., 2])
    return L, b
res = []
for line in open(src):
    r = json.loads(line)
    if not r.get("face"): res.append(None); continue
    path = r["id"].replace("http://127.0.0.1:8765/data/", os.environ.get("VALIDATION_DATA", "../../../validation-data") + "/")
    try: im = np.asarray(Image.open(path).convert("RGB")).astype(float)
    except Exception: res.append(None); continue
    H, W = im.shape[:2]; lm = r["lm"]
    xs = [p[0] * W for p in lm]; ys = [p[1] * H for p in lm]
    fw = max(xs) - min(xs); rad = max(2, int(fw * 0.06))
    patches = []
    for i in (50, 280, 117, 346):  # cheek points both sides
        x, y = int(lm[i][0] * W), int(lm[i][1] * H)
        p = im[max(0, y - rad):y + rad, max(0, x - rad):x + rad]
        if p.size: patches.append(p.reshape(-1, 3))
    if not patches: res.append(None); continue
    px = np.concatenate(patches); L, b = srgb_to_lab(px)
    Lm, bm = float(np.median(L)), float(np.median(b))
    ita = math.degrees(math.atan2(Lm - 50, bm))
    x0, x1, y0, y1 = int(max(0, min(xs))), int(min(W, max(xs))), int(max(0, min(ys))), int(min(H, max(ys)))
    bright = float(im[y0:y1, x0:x1].mean()) if x1 > x0 and y1 > y0 else None
    res.append({"ita": ita, "L": Lm, "bright": bright})
json.dump(res, open(out, "w"))
print(len(res), sum(1 for x in res if x))
