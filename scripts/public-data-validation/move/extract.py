import sys,os,csv,json,glob,cv2,mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from multiprocessing import Pool
FPS=15
def run(path):
    out='/tmp/w/move/lm/'+path.split('/')[-2].replace(' ','_')+'__'+os.path.basename(path)[:-4]+'.json'
    if os.path.exists(out): return out
    lm=vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path='/tmp/w/move/pose_landmarker_lite.task'),running_mode=vision.RunningMode.VIDEO,num_poses=1,min_pose_detection_confidence=0.6,min_tracking_confidence=0.6))
    cap=cv2.VideoCapture(path); fps=cap.get(cv2.CAP_PROP_FPS) or 30; W=int(cap.get(3)); H=int(cap.get(4))
    frames=[]; i=0; next_t=0.0
    while True:
        ok,fr=cap.read()
        if not ok: break
        t=i/fps; i+=1
        if t+1e-6<next_t: continue
        next_t+=1/FPS
        r=lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(fr,cv2.COLOR_BGR2RGB)),int(t*1000))
        pts=[[round(p.x,4),round(p.y,4),round(p.visibility or 0,3),round(p.presence or 0,3)] for p in r.pose_landmarks[0]] if r.pose_landmarks else None
        frames.append([int(t*1000),pts])
    json.dump({'w':W,'h':H,'fps':fps,'frames':frames},open(out,'w'))
    lm.close(); return out
if __name__=='__main__':
    os.makedirs('/tmp/w/move/lm',exist_ok=True)
    paths=sorted(glob.glob('/tmp/w/kin/vids/*/*.mp4')+glob.glob('/tmp/w/kin/vtrain/*/*.mp4'))
    ids=set()
    for sp in ['train','val']:
        for r in csv.DictReader(open(f'/tmp/w/kin/countix/countix_{sp}.csv')): ids.add(r['video_id'])
    paths=[p for p in paths if os.path.basename(p)[:11] in ids]
    print(len(paths),flush=True)
    with Pool(4) as pool:
        for k,o in enumerate(pool.imap_unordered(run,paths)):
            if k%25==0: print(k,flush=True)
    print('done')
