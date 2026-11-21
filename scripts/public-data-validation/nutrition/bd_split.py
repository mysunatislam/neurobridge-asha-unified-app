# Grouped split of the Bangladeshi photos. Near-duplicate photos (burst shots of the same plate,
# cosine >= 0.95 between embeddings, chained) form one "scene"; a scene is never split across
# train and test. Classes with fewer than 8 distinct scenes are left out. About 30% of each class's
# scenes go to test (at least 2), chosen at random with seed 7.
import json, collections, numpy as np
ok = json.load(open('/tmp/w/nut/bd/bd_meta.json'))
scenes = collections.defaultdict(lambda: collections.defaultdict(list))
for i, it in enumerate(ok): scenes[it['cls']][it['group']].append(i)
rng = np.random.default_rng(7); dropped = {}
for c, g in sorted(scenes.items()):
    keys = sorted(g); rng.shuffle(keys)
    if len(keys) < 8:
        dropped[c] = len(keys)
        for k in keys:
            for i in g[k]: ok[i]['split'] = 'dropped'
        continue
    nt = max(2, round(len(keys) * 0.3))
    for j, k in enumerate(keys):
        for i in g[k]: ok[i]['split'] = 'test' if j < nt else 'train'
json.dump(ok, open('/tmp/w/nut/bd/bd_meta.json', 'w'))
ct = collections.Counter((it['cls'], it['split']) for it in ok)
sc = collections.Counter((it['cls'], it['split']) for it in {(it['cls'], it['group'], it['split']): it for it in ok}.values())
print('dropped (scenes):', dropped)
for c in sorted(scenes):
    if c not in dropped: print(f"{c:16s} train {ct[(c,'train')]:3d} photos / {sc[(c,'train')]:3d} scenes   test {ct[(c,'test')]:3d} / {sc[(c,'test')]:3d}")
print('total train', sum(v for (c, s), v in ct.items() if s == 'train'), 'test', sum(v for (c, s), v in ct.items() if s == 'test'))
