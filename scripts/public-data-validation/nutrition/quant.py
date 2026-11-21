import json,random,numpy as np
from PIL import Image
from onnxruntime.quantization import quantize_static, CalibrationDataReader, QuantFormat, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process
meta=json.load(open('cls_effl0.json'))
tr=[m['key'] for m in meta if m['key'].startswith('train_')]; random.seed(3); random.shuffle(tr)
def prep(k):
    im=Image.open(f'img/{k}.jpg').convert('RGB'); W,H=im.size; s=round(min(W,H)*0.8); x=round((W-s)/2); y=round((H-s)/2)
    return np.asarray(im.crop((x,y,x+s,y+s)).resize((224,224),Image.BILINEAR),dtype=np.float32)[None]
class R(CalibrationDataReader):
    def __init__(s): s.it=iter(tr[:300])
    def get_next(s):
        k=next(s.it,None); return None if k is None else {'image':prep(k)}
quant_pre_process('export/food_fp32.onnx','export/food_pre.onnx')
quantize_static('export/food_pre.onnx','export/food_int8.onnx',R(),quant_format=QuantFormat.QDQ,per_channel=True,activation_type=QuantType.QUInt8,weight_type=QuantType.QInt8)
import os; print(os.path.getsize('export/food_int8.onnx'))
