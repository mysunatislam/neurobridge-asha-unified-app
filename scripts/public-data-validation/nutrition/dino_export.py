# Builds the shipped food model from DINOv2-small (int8, dynamic quantisation, Apache-2.0) and the
# Open Images + Bangladeshi head trained on its embeddings (bd_train.py with BACKBONE=dino paths).
# The graph takes the same input as before (1 x 224 x 224 x 3, RGB 0-255, centre 80% crop) and does the
# DINOv2 normalisation itself, so the browser worker only changes its file name.
# The source graph is opset 11, so Squeeze/Reduce* take axes as attributes.
# Embedding = [CLS token, mean of patch tokens], L2-normalised, then the logistic-regression head.
import json, os, pickle, numpy as np, onnx
from onnx import helper as h, numpy_helper as nh, TensorProto as T
SRC = '/mnt/user-data/uploads/datasets/dinov2-small/model_quantized.onnx'
D = '/tmp/w/nut/export_dino'; os.makedirs(D, exist_ok=True)
m, classes = pickle.load(open('/tmp/w/nut/dino/head.pkl', 'rb'))
g = onnx.load(SRC); G = g.graph
assert [i.name for i in G.input] == ['pixel_values'] and [o.name for o in G.output] == ['last_hidden_state']
mean = np.array([0.485, 0.456, 0.406], np.float32) * 255; std = np.array([0.229, 0.224, 0.225], np.float32) * 255
init = [nh.from_array(mean.reshape(1, 3, 1, 1), 'asha_mean'), nh.from_array(std.reshape(1, 3, 1, 1), 'asha_std'),
        nh.from_array(np.array([0], np.int64), 'asha_i0'), nh.from_array(np.array([1], np.int64), 'asha_i1'),
        nh.from_array(np.array([1 << 30], np.int64), 'asha_big'), nh.from_array(np.array([1e-12], np.float32), 'asha_eps'),
        nh.from_array(m.coef_.T.astype(np.float32), 'asha_W'), nh.from_array(m.intercept_.astype(np.float32), 'asha_b')]
pre = [h.make_node('Transpose', ['image'], ['asha_nchw'], perm=[0, 3, 1, 2]),
       h.make_node('Sub', ['asha_nchw', 'asha_mean'], ['asha_c']),
       h.make_node('Div', ['asha_c', 'asha_std'], ['pixel_values'])]
post = [h.make_node('Slice', ['last_hidden_state', 'asha_i0', 'asha_i1', 'asha_i1'], ['asha_cls3']),   # [1,1,384]
        h.make_node('Squeeze', ['asha_cls3'], ['asha_cls'], axes=[1]),
        h.make_node('Slice', ['last_hidden_state', 'asha_i1', 'asha_big', 'asha_i1'], ['asha_patch']),
        h.make_node('ReduceMean', ['asha_patch'], ['asha_pmean'], axes=[1], keepdims=0),
        h.make_node('Concat', ['asha_cls', 'asha_pmean'], ['asha_f'], axis=1),
        h.make_node('ReduceL2', ['asha_f'], ['asha_n'], axes=[1], keepdims=1),
        h.make_node('Max', ['asha_n', 'asha_eps'], ['asha_n2']),
        h.make_node('Div', ['asha_f', 'asha_n2'], ['asha_fn']),
        h.make_node('MatMul', ['asha_fn', 'asha_W'], ['asha_l']),
        h.make_node('Add', ['asha_l', 'asha_b'], ['asha_logits']),
        h.make_node('Softmax', ['asha_logits'], ['probs'], axis=1)]
nodes = pre + list(G.node) + post
G2 = h.make_graph(nodes, 'asha_food_dinov2s', [h.make_tensor_value_info('image', T.FLOAT, [1, 224, 224, 3])],
                  [h.make_tensor_value_info('probs', T.FLOAT, [1, len(classes)])], list(G.initializer) + init)
out = h.make_model(G2, opset_imports=g.opset_import, producer_name='asha')
out.ir_version = g.ir_version
onnx.checker.check_model(out)
onnx.save(out, f'{D}/food_int8.onnx'); json.dump(classes, open(f'{D}/classes.json', 'w'))
print(len(classes), os.path.getsize(f'{D}/food_int8.onnx'))
