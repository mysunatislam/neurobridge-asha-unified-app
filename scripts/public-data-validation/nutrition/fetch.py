import json,os,io,sys,urllib.request,concurrent.futures as cf
from PIL import Image
S=json.load(open('oi_sample.json'))
os.makedirs('img',exist_ok=True)
def get(d):
    key=f"{d['split']}_{d['img']}_{d['cls']}"
    out=f"img/{key}.jpg"
    if os.path.exists(out): return key,True
    try:
        b=urllib.request.urlopen(f"https://open-images-dataset.s3.amazonaws.com/{d['split']}/{d['img']}.jpg",timeout=30).read()
        im=Image.open(io.BytesIO(b)).convert('RGB')
        if d['box']:
            W,H=im.size; x0,y0,x1,y1=d['box']; mx=(x1-x0)*0.15; my=(y1-y0)*0.15
            im=im.crop((max(0,(x0-mx)*W),max(0,(y0-my)*H),min(W,(x1+mx)*W),min(H,(y1+my)*H)))
        im.thumbnail((448,448)); im.save(out,quality=90); return key,True
    except Exception as e: return key,str(e)[:80]
items=S['train']+S['test']
bad=0
with cf.ThreadPoolExecutor(32) as ex:
    for i,(k,ok) in enumerate(ex.map(get,items)):
        if ok is not True: bad+=1
        if i%2000==0: print(i,bad,flush=True)
print('done',len(items),bad)
