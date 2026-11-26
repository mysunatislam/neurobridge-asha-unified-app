# Evaluates the exported ONNX files (int8 shipped, fp32 reference) and the previous 35-class int8
# model on the held-out Open Images photos and the held-out Bangladeshi photos.
import json, os, sys, collections, numpy as np, onnxruntime as ort
# BACKBONE=dino evaluates the DINOv2-small model (export_dino) against the EfficientNetV2-B0 66-class
# model it replaces; there is no fp32 file for it, so its int8 file is evaluated twice under both names.
DINO = os.environ.get('BACKBONE') == 'dino'
from PIL import Image
sys.path.insert(0, '/tmp/w/nut')
from evalcore import parse, report, wilson
D = '/tmp/w/nut/export_dino' if DINO else '/tmp/w/nut/export_bd'
classes = json.load(open(f'{D}/classes.json')); ci = {c: i for i, c in enumerate(classes)}
PREV_D = '/tmp/w/nut/export_bd' if DINO else '/tmp/w/nut/export'
old_classes = json.load(open(f'{PREV_D}/classes.json'))
meta = json.load(open('/tmp/w/nut/cls_effl0.json')); bd = json.load(open('/tmp/w/nut/bd/bd_meta.json'))
oi_te = [(f"/tmp/w/nut/img/{m['key']}.jpg", parse(m['key'])[2], None) for m in meta if not m['key'].startswith('train_') and parse(m['key'])[2] in old_classes]
bd_te = [(b['path'], b['cls'], b['group']) for b in bd if b['split'] == 'test']
def prep(p):
    im = Image.open(p); im.seek(0); im = im.convert('RGB'); W, H = im.size; s = round(min(W, H) * 0.8); x = round((W - s) / 2); y = round((H - s) / 2)
    return np.asarray(im.crop((x, y, x + s, y + s)).resize((224, 224), Image.BILINEAR), dtype=np.float32)[None]
X = {'oi': [prep(p) for p, _, _ in oi_te], 'bd': [prep(p) for p, _, _ in bd_te]}
def run(path, xs):
    so = ort.SessionOptions(); so.intra_op_num_threads = 4; s = ort.InferenceSession(path, so)
    return np.concatenate([s.run(None, {'image': x})[0] for x in xs])
P = {}
for name, path in [('int8', f'{D}/food_int8.onnx'), ('fp32', f'{D}/food_int8.onnx' if DINO else f'{D}/food_fp32.onnx'), ('prev_int8', f'{PREV_D}/food_int8.onnx')]:
    for ds in ['oi', 'bd']: P[(name, ds)] = run(path, X[ds])
res = {'classes': classes}
for ds, items in [('oi', oi_te), ('bd', bd_te)]:
    y = np.array([ci[c] for _, c, _ in items])
    for name in ['int8', 'fp32']:
        r = report(y, P[(name, ds)], classes, f'{name}_{ds}'); res[f'{name}_{ds}'] = r
        print(f'{name} {ds} n {r["n"]} top1 {r["top1"]:.4f} {tuple(round(v, 4) for v in r["top1_ci"])} top5 {r["top5"]:.4f} macroR {r["macro_recall"]:.4f}')
    Pp = P[('prev_int8', ds)]; pp = [old_classes[k] for k in Pp.argmax(1)]
    k = sum(p == c for p, (_, c, _) in zip(pp, items)); res[f'prev_int8_{ds}_top1'] = [k, len(items), wilson(k, len(items))]
    print(f'previous int8 on {ds}: top1 {k}/{len(items)} = {k / len(items):.4f}')
# Bangladeshi, one photo per scene
first = {}
for k, (_, _, g) in enumerate(bd_te): first.setdefault(g, k)
ks = sorted(first.values()); yb = np.array([ci[c] for _, c, _ in bd_te])
r = report(yb[ks], P[('int8', 'bd')][ks], classes, 'int8_bd_scene'); res['int8_bd_scene'] = r
print(f'int8 bd one-per-scene n {r["n"]} top1 {r["top1"]:.4f} {tuple(round(v, 4) for v in r["top1_ci"])}')
# What the app fills in at minScore 0.5 (dishes with USDA records)
DISH = {'apple': 'apple', 'banana': 'banana', 'strawberry': 'strawberries', 'rice': 'rice', 'orange': 'orange', 'pear': 'pear', 'peach': 'peach',
        'pomegranate': 'pomegranate', 'tomato': 'tomato', 'dal': 'dal', 'fish_curry': 'fish_curry'}
PREV = set(DISH) - {'orange'} if DINO else {'apple', 'banana', 'strawberry', 'rice'}
PREV_FILLMIN = {'apple': 0.75, 'banana': 0.5, 'strawberry': 0.5, 'rice': 0.85, 'pear': 0.5, 'peach': 0.9, 'pomegranate': 0.5, 'tomato': 0.6, 'dal': 0.5, 'fish_curry': 0.5}
if DINO:
    FILLMIN = {k: v['threshold'] for k, v in json.load(open('/tmp/w/nut/dino/fill_thresholds.json')).items() if v['threshold'] is not None}
else:
    FILLMIN = PREV_FILLMIN
print('fillMin', FILLMIN)
def fills(Pm, cls_list, items, mapping, fillmin=None):
    out = collections.Counter(); per = collections.defaultdict(lambda: [0, 0])
    for row, (_, c, _) in zip(Pm, items):
        k = int(row.argmax()); lab = cls_list[k]
        if lab in mapping and row[k] >= (fillmin.get(lab, 9) if fillmin else 0.5):
            ok = lab == c; out['correct' if ok else 'wrong'] += 1; per[lab][0 if ok else 1] += 1
    return dict(out), {k: v for k, v in per.items()}
for ds, items in [('oi', oi_te), ('bd', bd_te)]:
    res[f'fills_new_flat05_{ds}'] = fills(P[('int8', ds)], classes, items, DISH)
    res[f'fills_new_{ds}'] = fills(P[('int8', ds)], classes, items, DISH, FILLMIN)
    print(ds, 'fills new at a flat 0.5 (not used)', res[f'fills_new_flat05_{ds}'][0])
    res[f'fills_prev_{ds}'] = fills(P[('prev_int8', ds)], old_classes, items, PREV, PREV_FILLMIN if DINO else None)
    print(ds, 'fills new', res[f'fills_new_{ds}'], '\n   prev', res[f'fills_prev_{ds}'])
# Coverage vs accuracy, both sets together
yall = np.concatenate([np.array([ci[c] for _, c, _ in oi_te]), yb]); Pall = np.concatenate([P[('int8', 'oi')], P[('int8', 'bd')]])
pred = Pall.argmax(1); conf = Pall.max(1); res['coverage'] = []
for t in [0, 0.5, 0.6, 0.7, 0.8, 0.9]:
    a = conf >= t; k = int((pred[a] == yall[a]).sum()); n = int(a.sum())
    res['coverage'].append({'threshold': t, 'coverage': n / len(yall), 'accuracy_when_shown': k / max(1, n), 'ci': wilson(k, n)}); print(res['coverage'][-1])
# orange vs apple on OI
yo = np.array([ci[c] for _, c, _ in oi_te]); po = P[('int8', 'oi')].argmax(1)
res['orange_as_apple'] = [int(((yo == ci['orange']) & (po == ci['apple'])).sum()), int((yo == ci['orange']).sum())]
print('orange as apple', res['orange_as_apple'])
res['fillMin'] = FILLMIN
json.dump(res, open(f'{D}/final_eval.json', 'w'), default=float)
