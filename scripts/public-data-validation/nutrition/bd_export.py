# Exports backbone + the Open Images + Bangladeshi head to ONNX and quantises it to int8
# (static, QDQ, per-channel; 240 Open Images + 60 Bangladeshi training photos for calibration).
import os, json, pickle, random, numpy as np
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf, tf2onnx
from PIL import Image
from onnxruntime.quantization import quantize_static, CalibrationDataReader, QuantFormat, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process
D = '/tmp/w/nut/export_bd'; os.makedirs(D, exist_ok=True)
m, classes = pickle.load(open('/tmp/w/nut/head_effv2b0_bd.pkl', 'rb'))
base = tf.keras.applications.EfficientNetV2B0(include_top=False, pooling='avg', weights='imagenet')
inp = tf.keras.Input((224, 224, 3), name='image')
f = tf.keras.layers.UnitNormalization(axis=-1)(base(inp))
d = tf.keras.layers.Dense(len(classes), name='head'); out = tf.keras.layers.Softmax(name='probs')(d(f))
model = tf.keras.Model(inp, out); d.set_weights([m.coef_.T.astype(np.float32), m.intercept_.astype(np.float32)])
tf2onnx.convert.from_keras(model, input_signature=(tf.TensorSpec((1, 224, 224, 3), tf.float32, name='image'),), opset=17, output_path=f'{D}/food_fp32.onnx')
json.dump(classes, open(f'{D}/classes.json', 'w'))
def prep(p):
    im = Image.open(p); im.seek(0); im = im.convert('RGB'); W, H = im.size; s = round(min(W, H) * 0.8); x = round((W - s) / 2); y = round((H - s) / 2)
    return np.asarray(im.crop((x, y, x + s, y + s)).resize((224, 224), Image.BILINEAR), dtype=np.float32)[None]
meta = json.load(open('/tmp/w/nut/cls_effl0.json')); bd = json.load(open('/tmp/w/nut/bd/bd_meta.json'))
oi = [f"/tmp/w/nut/img/{x['key']}.jpg" for x in meta if x['key'].startswith('train_')]; random.seed(3); random.shuffle(oi)
bdp = [b['path'] for b in bd if b['split'] == 'train']; random.shuffle(bdp)
cal = oi[:240] + bdp[:60]
class R(CalibrationDataReader):
    def __init__(s): s.it = iter(cal)
    def get_next(s):
        p = next(s.it, None); return None if p is None else {'image': prep(p)}
quant_pre_process(f'{D}/food_fp32.onnx', f'{D}/food_pre.onnx')
quantize_static(f'{D}/food_pre.onnx', f'{D}/food_int8.onnx', R(), quant_format=QuantFormat.QDQ, per_channel=True, activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8)
print(len(classes), os.path.getsize(f'{D}/food_int8.onnx'))
