# Per-food fill-in thresholds, chosen on held-out photos from the TRAINING side only (the same
# holdout bd_train.py uses: OI train 20%, BD train scenes 25%; head refit on the rest with the chosen
# C and weight). For each food ASHA can fill in, the lowest score from 0.5 up (0.05 steps) where at
# least 90% of fills on the holdout are right. A food that never gets there is named only, not filled.
import json, sys, collections, numpy as np
sys.path.insert(0, '/tmp/w/nut')
from evalcore import parse, wilson
from sklearn.linear_model import LogisticRegression
meta = json.load(open('/tmp/w/nut/cls_effl0.json')); E = np.load('/tmp/w/nut/emb_effv2b0.npy')
bd = json.load(open('/tmp/w/nut/bd/bd_meta.json')); EB = np.load('/tmp/w/nut/bd/emb_bd_effv2b0.npy')
ev = json.load(open('/tmp/w/nut/bd/bd_train_eval.json')); C, boost, classes = ev['C'], ev['bd_boost'], ev['classes']; ci = {c: k for k, c in enumerate(classes)}
import pickle; _, old_classes = pickle.load(open('/tmp/w/nut/head_effv2b0.pkl', 'rb'))
sp = [parse(m['key'])[0] for m in meta]; cl = [parse(m['key'])[2] for m in meta]
oi_tr = [i for i, c in enumerate(cl) if sp[i] == 'train' and c in old_classes]
bd_tr = [i for i, b in enumerate(bd) if b['split'] == 'train']
scene_n = collections.Counter(bd[i]['group'] for i in bd_tr)
rng = np.random.default_rng(1)
oi_perm = rng.permutation(oi_tr); oi_v, oi_t = list(oi_perm[:len(oi_perm) // 5]), list(oi_perm[len(oi_perm) // 5:])
groups = sorted({bd[i]['group'] for i in bd_tr}); rng.shuffle(groups); gv = set(groups[:len(groups) // 4])
bd_v = [i for i in bd_tr if bd[i]['group'] in gv]; bd_t = [i for i in bd_tr if bd[i]['group'] not in gv]
X = np.concatenate([E[oi_t], EB[bd_t]]); y = np.array([ci[cl[i]] for i in oi_t] + [ci[bd[i]['cls']] for i in bd_t])
w = np.concatenate([np.ones(len(oi_t)), boost / np.array([scene_n[bd[i]['group']] for i in bd_t])])
cw = collections.defaultdict(float)
for yy, ww in zip(y, w): cw[yy] += ww
w = w * np.array([len(y) / (len(cw) * cw[yy]) for yy in y])
m = LogisticRegression(C=C, max_iter=4000).fit(X, y, sample_weight=w)
Xv = np.concatenate([E[oi_v], EB[bd_v]]); yv = np.array([ci[cl[i]] for i in oi_v] + [ci[bd[i]['cls']] for i in bd_v])
P = m.predict_proba(Xv); pred = P.argmax(1); conf = P.max(1)
FILL = ['apple', 'banana', 'strawberry', 'rice', 'orange', 'pear', 'peach', 'pomegranate', 'tomato', 'dal', 'fish_curry']
out = {}
for lab in FILL:
    k = ci[lab]; chosen = None; rows = []
    for t in np.arange(0.5, 0.96, 0.05):
        sel = (pred == k) & (conf >= t); n = int(sel.sum()); good = int((yv[sel] == k).sum())
        rows.append((round(float(t), 2), good, n))
        if chosen is None and n >= 5 and good / n >= 0.9: chosen = round(float(t), 2)
    out[lab] = {'threshold': chosen, 'holdout': rows}
    print(f'{lab:12s} threshold {chosen}  ', rows[:6])
json.dump(out, open('/tmp/w/nut/bd/fill_thresholds.json', 'w'))
