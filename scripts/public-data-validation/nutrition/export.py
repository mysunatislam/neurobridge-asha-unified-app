import os,json,pickle,numpy as np
os.environ['TF_CPP_MIN_LOG_LEVEL']='3'
import tensorflow as tf, tf2onnx
m,classes=pickle.load(open('head_effv2b0.pkl','rb'))
print(classes, m.coef_.shape)
base=tf.keras.applications.EfficientNetV2B0(include_top=False,pooling='avg',weights='imagenet')
inp=tf.keras.Input((224,224,3),name='image')
f=base(inp)
f=tf.keras.layers.UnitNormalization(axis=-1)(f)
d=tf.keras.layers.Dense(len(classes),name='head'); out=tf.keras.layers.Softmax(name='probs')(d(f))
model=tf.keras.Model(inp,out)
d.set_weights([m.coef_.T.astype(np.float32), m.intercept_.astype(np.float32)])
spec=(tf.TensorSpec((1,224,224,3),tf.float32,name='image'),)
tf2onnx.convert.from_keras(model,input_signature=spec,opset=17,output_path='export/food_fp32.onnx')
json.dump(classes,open('export/classes.json','w'))
print('ok', os.path.getsize('export/food_fp32.onnx'))
