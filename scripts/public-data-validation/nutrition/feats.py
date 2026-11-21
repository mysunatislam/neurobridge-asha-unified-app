# Run the app's current classifier and candidate embedders over every downloaded image.
import json,os,sys,numpy as np,mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from PIL import Image
from multiprocessing import Pool
S=json.load(open('oi_sample.json'))
def centre(im,f=0.8):
    W,H=im.size; s=round(min(W,H)*f); x=round((W-s)/2); y=round((H-s)/2)
    return im.crop((x,y,x+s,y+s)).resize((224,224),Image.BILINEAR)
def work(chunk):
    cls=vision.ImageClassifier.create_from_options(vision.ImageClassifierOptions(base_options=BaseOptions(model_asset_path='efficientnet_lite0_int8.tflite'),max_results=5))
    emb=vision.ImageEmbedder.create_from_options(vision.ImageEmbedderOptions(base_options=BaseOptions(model_asset_path='mobilenet_v3_large.tflite'),l2_normalize=True))
    out=[]
    for key in chunk:
        p=f'img/{key}.jpg'
        if not os.path.exists(p): out.append(None); continue
        im=centre(Image.open(p).convert('RGB'))
        m=mp.Image(image_format=mp.ImageFormat.SRGB,data=np.asarray(im))
        c=cls.classify(m).classifications[0].categories
        e=emb.embed(m).embeddings[0].embedding
        out.append({'key':key,'top':[(x.category_name,round(x.score,4)) for x in c],'emb':np.asarray(e,dtype=np.float32).tolist()})
    return out
if __name__=='__main__':
    keys=[f"{d['split']}_{d['img']}_{d['cls']}" for d in S['train']+S['test']]
    chunks=[keys[i::4] for i in range(4)]
    with Pool(4) as p: res=p.map(work,chunks)
    flat=[r for rr in res for r in rr if r]
    np.save('emb_mnv3.npy',np.array([r['emb'] for r in flat],dtype=np.float32))
    json.dump([{'key':r['key'],'top':r['top']} for r in flat],open('cls_effl0.json','w'))
    print(len(flat), len(flat[0]['emb']))
