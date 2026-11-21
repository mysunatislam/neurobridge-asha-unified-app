# Bangladeshi food photos (BD-Food33, CC0; Bangladeshi Street Food, CC BY 4.0): class mapping,
# EfficientNetV2-B0 embeddings with the app's preprocessing (centre 80% square, 224 x 224),
# near-duplicate grouping and a grouped 70/30 train/test split (seed 7).
import os, sys, json, glob, collections, numpy as np
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
from PIL import Image
ROOT = '/tmp/w/bd'
MAP33 = {'Rice': 'rice', 'Chomchom': 'chomchom', 'Pizza': 'pizza', 'Burger': 'hamburger', 'Rupchanda Fry': 'fried_fish',
         'Fuchka': 'fuchka', 'Pera Sondesh': 'sandesh', 'Chicken Roast': 'roast_chicken', 'Mutton Leg Roast': 'mutton_roast',
         'Shawarma': 'shawarma', 'Chicken': 'chicken_curry', 'Jalebi': 'jalebi', 'Egg Curry': 'egg_curry', 'Singara': 'singara_samosa',
         'Jhalmuri': 'jhalmuri', 'Shorshe Ilish': 'fish_curry', 'Chowmein': 'noodles', 'Dal': 'dal', 'Tikka': 'kabab',
         'French Fries': 'french_fries', 'Bakorkhani': 'bakarkhani', 'Chingri Vuna': 'prawn_curry', 'Paratha': 'paratha',
         'Roshmalai': 'rasmalai', 'Alu Vorta': 'bhorta', 'Shami Kabab': 'kabab', 'Fried Chicken': 'fried_chicken', 'Tea': 'tea',
         'Kotkoti': 'kotkoti', 'Morog Polao': 'polao', 'Peyaju': 'peyaju', 'Bhapa': 'pitha', 'Puli Pitha': 'pitha'}
MAPST = {'Muglai': 'muglai_paratha', 'Pizza': 'pizza', 'Chop': 'chop', 'Somusha': 'singara_samosa', 'Beguni': 'beguni',
         'Fuska': 'fuchka', 'Achar': 'achar', 'Kabab': 'kabab', 'Badam': 'peanuts', 'Singara': 'singara_samosa',
         'Jhalmuri': 'jhalmuri', 'Tea': 'tea', 'Halim': 'haleem'}  # dropped (< 15 photos): Chotpoti, Seafood, Ice cream, Puri, Juice
items = []
for d, c in MAP33.items():
    for f in sorted(glob.glob(f'{ROOT}/food33x/{d}/*')): items.append({'path': f, 'cls': c, 'src': 'BD-Food33'})
for d, c in MAPST.items():
    for f in sorted(glob.glob(f'{ROOT}/street/Bangladeshi Street Food/Street_Food_Image_Dataset/{d}/*')): items.append({'path': f, 'cls': c, 'src': 'Bangladeshi Street Food'})
def centre(p, f=0.8, size=224):
    im = Image.open(p); im.seek(0); im = im.convert('RGB'); W, H = im.size; s = round(min(W, H) * f); x = round((W - s) / 2); y = round((H - s) / 2)
    return np.asarray(im.crop((x, y, x + s, y + s)).resize((size, size), Image.BILINEAR), dtype=np.float32)
import tensorflow as tf
m = tf.keras.applications.EfficientNetV2B0(include_top=False, pooling='avg', weights='imagenet')
ok, X = [], []
for it in items:
    try: X.append(centre(it['path'])); ok.append(it)
    except Exception as e: print('skip', it['path'], e)
E = np.concatenate([m.predict(np.stack(X[i:i + 64]), verbose=0) for i in range(0, len(X), 64)])
E /= np.linalg.norm(E, axis=1, keepdims=True)
# Near-duplicates (cosine >= 0.95) share a group so a copy never sits on both sides of the split.
S = E @ E.T; n = len(ok); parent = list(range(n))
def find(a):
    while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
    return a
dups = 0
for i in range(n):
    for j in np.nonzero(S[i, i + 1:] >= 0.95)[0] + i + 1:
        ri, rj = find(i), find(int(j))
        if ri != rj: parent[rj] = ri; dups += 1
rng = np.random.default_rng(7)
bycls = collections.defaultdict(list)
for i, it in enumerate(ok): it['group'] = find(i); bycls[it['cls']].append(i)
for c, idx in bycls.items():
    groups = sorted({ok[i]['group'] for i in idx}); rng.shuffle(groups)
    test = set(groups[:max(1, round(len(groups) * 0.3))])
    for i in idx: ok[i]['split'] = 'test' if ok[i]['group'] in test else 'train'
json.dump(ok, open('/tmp/w/nut/bd/bd_meta.json', 'w')); np.save('/tmp/w/nut/bd/emb_bd_effv2b0.npy', E.astype(np.float32))
ct = collections.Counter((it['cls'], it['split']) for it in ok)
print('images', n, 'duplicate links', dups, 'groups', len({it['group'] for it in ok}))
for c in sorted(bycls): print(c, ct[(c, 'train')], ct[(c, 'test')])
