import joblib
import os
paths=[os.getenv('MODEL_PATH','').strip(), 'model.joblib', os.path.join(os.path.dirname(__file__), '..', 'model.joblib')]
for p in paths:
    if not p:
        continue
    p=os.path.abspath(p)
    if os.path.exists(p):
        print('Trying',p)
        try:
            m=joblib.load(p)
            print('Loaded OK:', type(m))
        except Exception as e:
            print('Load failed:',e)
    else:
        print('Not found:',p)
