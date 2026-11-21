import os,sys,json,numpy as np
os.environ['TF_CPP_MIN_LOG_LEVEL']='3'
import tensorflow as tf
from PIL import Image
name=sys.argv[1]
if name=='effv2b0':
    m=tf.keras.applications.EfficientNetV2B0(include_top=False,pooling='avg',weights='imagenet'); size=224
elif name=='convnext_t':
    m=tf.keras.applications.ConvNeXtTiny(include_top=False,pooling='avg',weights='imagenet'); size=224
elif name=='effv2s':
    m=tf.keras.applications.EfficientNetV2S(include_top=False,pooling='avg',weights='imagenet'); size=300
meta=json.load(open('cls_effl0.json'))
def centre(p,f=0.8):
    im=Image.open(p).convert('RGB'); W,H=im.size; s=round(min(W,H)*f); x=round((W-s)/2); y=round((H-s)/2)
    return np.asarray(im.crop((x,y,x+s,y+s)).resize((size,size),Image.BILINEAR),dtype=np.float32)
out=[]
B=64
for i in range(0,len(meta),B):
    x=np.stack([centre(f"img/{m_['key']}.jpg") for m_ in meta[i:i+B]])
    out.append(m.predict(x,verbose=0))
    if i%2048==0: print(i,flush=True)
E=np.concatenate(out); E/=np.linalg.norm(E,axis=1,keepdims=True)
np.save(f'emb_{name}.npy',E.astype(np.float32)); print('done',E.shape)
