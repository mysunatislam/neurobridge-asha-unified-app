import json,numpy as np,collections,math
def parse(key):
    sp,img,cls=key.split('_',2); return sp,img,cls
def wilson(k,n,z=1.96):
    if n==0: return (float('nan'),)*2
    p=k/n; d=1+z*z/n; c=p+z*z/(2*n); r=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))
    return ((c-r)/d,(c+r)/d)
def report(y,P,classes,name):
    """y: int labels, P: prob matrix. Returns dict of metrics."""
    y=np.asarray(y); pred=P.argmax(1); n=len(y)
    top1=(pred==y).sum(); top5=sum(y[i] in np.argsort(-P[i])[:5] for i in range(n))
    K=len(classes); cm=np.zeros((K,K),int)
    for a,b in zip(y,pred): cm[a,b]+=1
    per={}
    for k,c in enumerate(classes):
        tp=cm[k,k]; fn=cm[k].sum()-tp; fp=cm[:,k].sum()-tp
        per[c]={'n':int(cm[k].sum()),'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,'recall_ci':wilson(tp,tp+fn),'f1':(2*tp/(2*tp+fp+fn)) if tp else 0.0,
                'top_confusions':[(classes[j],int(cm[k,j])) for j in np.argsort(-cm[k]) if j!=k and cm[k,j]>0][:3]}
    rng=np.random.default_rng(0); boots=[]
    for _ in range(1000):
        idx=rng.integers(0,n,n); boots.append((pred[idx]==y[idx]).mean())
    macro=np.mean([v['recall'] for v in per.values() if v['recall'] is not None])
    return {'name':name,'n':n,'top1':top1/n,'top1_ci':wilson(top1,n),'top1_boot_ci':(float(np.percentile(boots,2.5)),float(np.percentile(boots,97.5))),'top5':top5/n,'top5_ci':wilson(top5,n),'macro_recall':macro,'per_class':per,'cm':cm.tolist(),'classes':classes}
