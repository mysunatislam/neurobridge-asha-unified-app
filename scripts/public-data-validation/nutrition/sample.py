import sys,csv,random,collections,json
sys.path.insert(0,'/tmp/w/nut')
from classes import MID, C
random.seed(7)
box=set(l.split(',')[0] for l in open('/tmp/w/oi/oidv7-class-descriptions-boxable.csv'))
FOODISH={'/m/02wbm','/m/02xwb','/m/0f4s2w','/m/02q08p0','/m/0krfg','/m/01ykh','/m/022tld'} | set(MID)
def load(split, labelfile, bboxfile, cap):
    pos=collections.defaultdict(set); foodish=set(); allimgs=[]
    seen=set()
    with open(labelfile) as f:
        next(f)
        for line in f:
            p=line.rstrip('\r\n').split(',')
            if p[0] not in seen: seen.add(p[0]); allimgs.append(p[0])
            if p[3]=='1':
                if p[2] in MID: pos[p[0]].add(MID[p[2]])
                if p[2] in FOODISH: foodish.add(p[0])
    boxes=collections.defaultdict(list)
    with open(bboxfile) as f:
        next(f)
        for line in f:
            p=line.rstrip('\r\n').split(',')
            if p[2] in MID and MID[p[2]] in {MID[m] for m in box if m in MID}:
                x0,x1,y0,y1=map(float,p[4:8]); dep=p[11]
                if dep=='1' or (x1-x0)*(y1-y0)<0.02: continue
                boxes[(p[0],MID[p[2]])].append((x0,y0,x1,y1,(x1-x0)*(y1-y0)))
    items=collections.defaultdict(list)
    for img,cs in pos.items():
        for c in cs:
            b=boxes.get((img,c))
            if b:
                bb=max(b,key=lambda t:t[4]); items[c].append({'img':img,'cls':c,'box':bb[:4],'split':split,'n_other':len(cs)-1})
            elif len(cs)==1 and not any(m in box for m in C[c]):
                items[c].append({'img':img,'cls':c,'box':None,'split':split,'n_other':0})
    out=[]
    for c,l in items.items():
        random.shuffle(l); l.sort(key=lambda d:d['n_other'])  # prefer single-food images
        out+=l[:cap]
    neg=[i for i in allimgs if i not in foodish]; random.shuffle(neg)
    out+=[{'img':i,'cls':'not_food','box':None,'split':split,'n_other':0} for i in neg[:cap*2]]
    return out
tr=load('train','/tmp/w/oi/oidv7-train-labels.csv','/tmp/w/oi/train-bbox.csv',300)
te=load('validation','/tmp/w/oi/oidv7-val-labels.csv','/tmp/w/oi/validation-bbox.csv',150)+load('test','/tmp/w/oi/oidv7-test-labels.csv','/tmp/w/oi/test-bbox.csv',150)
json.dump({'train':tr,'test':te},open('oi_sample.json','w'))
ct=collections.Counter(d['cls'] for d in tr); ce=collections.Counter(d['cls'] for d in te)
for c in sorted(set(ct)|set(ce)): print(c, ct[c], ce[c])
print(len(tr),len(te))
