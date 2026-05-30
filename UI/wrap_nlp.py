import subprocess
import json
import os
import sys

# Move to the project root relative to this script
os.chdir('..')

env = os.environ.copy()
env['PYTHONUTF8'] = '1'
env['PYTHONIOENCODING'] = 'utf-8'
env['BERTURK_MODEL_NAME'] = 'backend/models/bert-base-turkish-cased'

data = {
    'clinical_note': 'Silikozis, kömür işçisi pnömokonyozu ve asbestozis öyküsü mevcut. Mesleki maruziyet düşündürüyor.',
    'description': 'Toraks BT'
}
input_json = json.dumps(data, ensure_ascii=False)

try:
    process = subprocess.Popen(
        [sys.executable, 'backend/nlp_analysis.py'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
        encoding='utf-8'
    )
    stdout, stderr = process.communicate(input=input_json)
    
    if process.returncode != 0:
        print(f'Error: {stderr}')
    else:
        try:
            result = json.loads(stdout)
            # Filter output for desired fields
            output = {
                'riskSignals': result.get('riskSignals'),
                'summary': result.get('summary'),
                'recommendedAction': result.get('recommendedAction'),
                'riskLevel': result.get('riskLevel'),
                'occupationalSignalFound': any('mesleki' in s.lower() or 'maruziyet' in s.lower() or 'silikozis' in s.lower() for s in result.get('riskSignals', []))
            }
            print(json.dumps(output, indent=2, ensure_ascii=False))
        except json.JSONDecodeError:
            print(f'Raw Output: {stdout}')
except Exception as e:
    print(f'Exception: {str(e)}')
