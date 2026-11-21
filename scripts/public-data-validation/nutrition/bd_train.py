# Trains the food head on Open Images train + Bangladeshi train photos (same EfficientNetV2-B0
# embeddings), picks C on held-out scenes from the training side only, and reports Open Images test
# and Bangladeshi test results for the old 35-class head and the new head.
import json, sys, pickle, collections, numpy as np
sys.path.insert(0, '/tmp/w/nut')
from evalcore import parse, report
from sklearn.linear_model import LogisticRegression
meta = json.load(open('/tmp/w/nut/cls_effl0.json')); E = np.load('/tmp/w/nut/emb_effv2b0.npy')
bd = json.load(open('/tmp/w/nut/bd/bd_meta.json')); EB = np.load('/tmp/w/nut/bd/emb_bd_effv2b0.npy')
old, old_classes = pickle.load(open('/tmp/w/nut/head_effv2b0.pkl', 'rb'))
sp = [parse(m['key'])[0] for m in meta]; cl = [parse(m['key'])[2] for m in meta]
bd_classes = sorted({b['cls'] for b in bd if b['split'] != 'dropped'})
classes = sorted(set(old_classes) | set(bd_classes)); ci = {c: k for k, c in enumerate(classes)}
print(len(classes), 'classes;', len(set(bd_classes) - set(old_classes)), 'new')
oi_tr = [i for i, c in enumerate(cl) if sp[i] == 'train' and c in old_classes]
oi_te = [i for i, c in enumerate(cl) if sp[i] != 'train' and c in old_classes]
bd_tr = [i for i, b in enumerate(bd) if b['split'] == 'train']; bd_te = [i for i, b in enumerate(bd) if b['split'] == 'test']
# Scene weights: each burst of near-identical photos counts once in total.
scene_n = collections.Counter(bd[i]['group'] for i in bd_tr)
def fit(oi_idx, bd_idx, C, bd_boost):
    X = np.concatenate([E[oi_idx], EB[bd_idx]])
    y = np.array([ci[cl[i]] for i in oi_idx] + [ci[bd[i]['cls']] for i in bd_idx])
    w = np.concatenate([np.ones(len(oi_idx)), bd_boost / np.array([scene_n[bd[i]['group']] for i in bd_idx])])
    # balance classes by total weight
    cw = collections.defaultdict(float)
    for yy, ww in zip(y, w): cw[yy] += ww
    w = w * np.array([len(y) / (len(cw) * cw[yy]) for yy in y])
    return LogisticRegression(C=C, max_iter=4000).fit(X, y, sample_weight=w)
# Choose C and BD weight on a holdout taken from the training side (OI train 20%, BD train scenes 25%).
rng = np.random.default_rng(1)
oi_perm = rng.permutation(oi_tr); oi_v, oi_t = list(oi_perm[:len(oi_perm) // 5]), list(oi_perm[len(oi_perm) // 5:])
groups = sorted({bd[i]['group'] for i in bd_tr}); rng.shuffle(groups); gv = set(groups[:len(groups) // 4])
bd_v = [i for i in bd_tr if bd[i]['group'] in gv]; bd_t = [i for i in bd_tr if bd[i]['group'] not in gv]
best = None
for C in [2, 8, 32]:
    for boost in [1, 3]:
        m = fit(oi_t, bd_t, C, boost)
        a_oi = (m.predict(E[oi_v]) == [ci[cl[i]] for i in oi_v]).mean()
        a_bd = (m.predict(EB[bd_v]) == [ci[bd[i]['cls']] for i in bd_v]).mean()
        score = (a_oi + a_bd) / 2
        print(f'C {C} boost {boost}: OI holdout {a_oi:.3f}  BD holdout {a_bd:.3f}')
        if not best or score > best[0]: best = (score, C, boost)
_, C, boost = best; print('chosen C', C, 'boost', boost)
m = fit(oi_tr, bd_tr, C, boost)
pickle.dump((m, classes), open('/tmp/w/nut/head_effv2b0_bd.pkl', 'wb'))
out = {'C': C, 'bd_boost': boost, 'classes': classes}
# Open Images test, old vs new
yo = np.array([ci[cl[i]] for i in oi_te])
out['oi_new'] = report(yo, m.predict_proba(E[oi_te]), classes, 'oi_new')
oci = {c: k for k, c in enumerate(old_classes)}
out['oi_old'] = report(np.array([oci[cl[i]] for i in oi_te]), old.predict_proba(E[oi_te]), old_classes, 'oi_old')
# Bangladeshi test: new head, and old head (which can only be right on classes it has)
yb = np.array([ci[bd[i]['cls']] for i in bd_te]); Pb = m.predict_proba(EB[bd_te])
out['bd_new'] = report(yb, Pb, classes, 'bd_new')
Po = old.predict_proba(EB[bd_te]); po = [old_classes[k] for k in Po.argmax(1)]
out['bd_old_top1'] = float(np.mean([p == bd[i]['cls'] for p, i in zip(po, bd_te)]))
# per scene: one vote per scene (its first photo)
first = {}
for k, i in enumerate(bd_te): first.setdefault(bd[i]['group'], k)
ks = sorted(first.values())
out['bd_new_scene'] = report(yb[ks], Pb[ks], classes, 'bd_new_scene')
for name in ['oi_old', 'oi_new', 'bd_new', 'bd_new_scene']:
    r = out[name]; print(name, 'n', r['n'], 'top1', round(r['top1'], 3), [round(x, 3) for x in r['top1_ci']], 'top5', round(r['top5'], 3), 'macroR', round(r['macro_recall'], 3))
print('bd old head top1', round(out['bd_old_top1'], 3))
for c in bd_classes:
    v = out['bd_new']['per_class'][c]; print(f"{c:16s} n {v['n']:3d} R {v['recall'] or 0:.2f} P {v['precision'] or 0:.2f}", v['top_confusions'])
json.dump(out, open('/tmp/w/nut/bd/bd_train_eval.json', 'w'), default=float)
