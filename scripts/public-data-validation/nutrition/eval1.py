import json,numpy as np,collections,sys
sys.path.insert(0,'/tmp/w/nut')
from evalcore import parse,wilson,report
from sklearn.linear_model import LogisticRegression
meta=json.load(open('cls_effl0.json')); E_=np.load(sys.argv[1] if len(sys.argv)>1 else 'emb_mnv3.npy')
sp=[parse(m['key'])[0] for m in meta]; cl=[parse(m['key'])[2] for m in meta]
ctr=collections.Counter(c for s,c in zip(sp,cl) if s=='train'); cte=collections.Counter(c for s,c in zip(sp,cl) if s!='train')
classes=sorted(c for c in ctr if ctr[c]>=25 and cte[c]>=20)
print(len(classes),classes)
keep=[i for i,c in enumerate(cl) if c in classes]
# --- Baseline: today's app (ImageNet EfficientNet-Lite0 + 3-label mapping, min score 0.3)
MAP={'banana':'banana','Granny Smith':'apple','strawberry':'strawberry'}
def app(top):
    for lab,s in top:
        if lab in MAP and s>=0.3: return MAP[lab]
    return None
base=collections.defaultdict(collections.Counter)
for i in keep:
    if sp[i]=='train': continue
    base[cl[i]][app(meta[i]['top']) or 'no suggestion']+=1
out={'baseline':{c:dict(v) for c,v in base.items()}}
for c in ['orange','apple','banana','strawberry','lemon_lime','grapefruit_pomelo','tomato','pear','peach','pomegranate','not_food']:
    v=base[c]; n=sum(v.values()); print('BASE',c,n,dict(v))
# raw imagenet top-1 for oranges
rawor=collections.Counter(meta[i]['top'][0][0] for i in keep if cl[i]=='orange' and sp[i]!='train')
print('orange raw top1',rawor.most_common(8))
rawap=collections.Counter(meta[i]['top'][0][0] for i in keep if cl[i]=='apple' and sp[i]!='train')
print('apple raw top1',rawap.most_common(8))
out['orange_raw_top1']=rawor.most_common(15); out['apple_raw_top1']=rawap.most_common(15)
# --- New: linear head on embeddings
ci={c:k for k,c in enumerate(classes)}
tr=[i for i in keep if sp[i]=='train']; te=[i for i in keep if sp[i]!='train']
X=E_[tr]; y=np.array([ci[cl[i]] for i in tr]); Xt=E_[te]; yt=np.array([ci[cl[i]] for i in te])
best=None
for C in [0.5,2,8]:
    m=LogisticRegression(C=C,max_iter=3000,class_weight='balanced')
    # simple holdout from train for C
    rng=np.random.default_rng(1); idx=rng.permutation(len(y)); v=idx[:len(y)//5]; t=idx[len(y)//5:]
    m.fit(X[t],y[t]); a=(m.predict(X[v])==y[v]).mean(); print('C',C,'val',round(a,3))
    if not best or a>best[1]: best=(C,a)
m=LogisticRegression(C=best[0],max_iter=3000,class_weight='balanced').fit(X,y)
P=m.predict_proba(Xt)
r=report(yt,P,classes,sys.argv[2] if len(sys.argv)>2 else 'mnv3')
print('TOP1',round(r['top1'],3),r['top1_ci'],'TOP5',round(r['top5'],3),'macroR',round(r['macro_recall'],3))
for c in ['orange','apple','banana','lemon_lime','rice','curry','not_food']:
    if c in r['per_class']: print(c,{k:v for k,v in r['per_class'][c].items()})
out['head']=r; out['C']=best[0]
json.dump(out,open(f"eval_{r['name']}.json",'w'),default=float)
import pickle; pickle.dump((m,classes),open(f"head_{r['name']}.pkl",'wb'))
