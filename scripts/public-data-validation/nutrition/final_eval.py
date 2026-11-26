import json,sys,numpy as np,collections,onnxruntime as ort
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,'.')
from evalcore import parse,report,wilson
classes=json.load(open('export/classes.json')); ci={c:i for i,c in enumerate(classes)}
meta=json.load(open('cls_effl0.json'))
test=[m for m in meta if not m['key'].startswith('train_') and parse(m['key'])[2] in ci]
def prep(k):
    im=Image.open(f'img/{k}.jpg').convert('RGB'); W,H=im.size; s=round(min(W,H)*0.8); x=round((W-s)/2); y=round((H-s)/2)
    return np.asarray(im.crop((x,y,x+s,y+s)).resize((224,224),Image.BILINEAR),dtype=np.float32)[None]
res={}
for name in ['food_int8','food_fp32']:
    so=ort.SessionOptions(); so.intra_op_num_threads=4
    s=ort.InferenceSession(f'export/{name}.onnx',so)
    P=np.concatenate([s.run(None,{'image':prep(m['key'])})[0] for m in test])
    np.save(f'export/P_{name}.npy',P)
    y=np.array([ci[parse(m['key'])[2]] for m in test])
    r=report(y,P,classes,name); res[name]=r
    print(name,'top1',round(r['top1'],4),r['top1_ci'],'top5',round(r['top5'],4),'macro',round(r['macro_recall'],4))
y=np.array([ci[parse(m['key'])[2]] for m in test]); P=np.load('export/P_food_int8.npy')
# grouped citrus
G={'orange':'orange_citrus','grapefruit_pomelo':'orange_citrus'}
gcls=sorted({G.get(c,c) for c in classes}); gi={c:i for i,c in enumerate(gcls)}
PG=np.zeros((len(P),len(gcls)))
for j,c in enumerate(classes): PG[:,gi[G.get(c,c)]]+=P[:,j]
yg=np.array([gi[G.get(classes[k],classes[k])] for k in y])
rg=report(yg,PG,gcls,'int8_citrus_grouped'); res['grouped']=rg
print('grouped top1',round(rg['top1'],4),rg['top1_ci'],'top5',round(rg['top5'],4))
# orange <-> apple
pred=P.argmax(1); o=ci['orange']; a=ci['apple']
oa=int(((y==o)&(pred==a)).sum()); no=int((y==o).sum()); ao=int(((y==a)&(pred==o)).sum()); na=int((y==a).sum())
MAP={'banana':'banana','Granny Smith':'apple','strawberry':'strawberry'}
def app(top):
    for lab,s in top:
        if lab in MAP and s>=0.3: return MAP[lab]
    return None
old=[app(m['top']) for m in test]
old_oa=sum(1 for m,p in zip(test,old) if parse(m['key'])[2]=='orange' and p=='apple')
res['orange_apple']={'new_orange_as_apple':[oa,no],'new_apple_as_orange':[ao,na],'old_orange_as_apple':[old_oa,no]}
print(res['orange_apple'])
# old app: per-class "correct suggestion" rate on the same test images
oldc=collections.defaultdict(lambda:[0,0,0])  # correct, wrong suggestion, none
for m,p in zip(test,old):
    c=parse(m['key'])[2]; k=0 if p==c else (2 if p is None else 1); oldc[c][k]+=1
res['old_app']={c:v for c,v in oldc.items()}
tot=np.array(list(oldc.values())).sum(0); print('old app overall correct/wrong/none',tot, tot/tot.sum())
res['old_app_total']=tot.tolist()
# coverage vs accuracy (food classes only, excluding not_food truth)
conf=P.max(1); curve=[]
for t in [0,0.3,0.4,0.5,0.6,0.7,0.8,0.9]:
    acc=conf>=t; k=int((pred[acc]==y[acc]).sum()); n=int(acc.sum())
    curve.append({'threshold':t,'coverage':n/len(y),'accuracy_when_shown':k/max(1,n),'ci':wilson(k,n)})
res['coverage']=curve
for c in curve: print(c)
json.dump(res,open('export/final_eval.json','w'),default=float)
