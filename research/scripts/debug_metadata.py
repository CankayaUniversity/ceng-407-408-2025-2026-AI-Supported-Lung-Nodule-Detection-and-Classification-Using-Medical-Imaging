import pandas as pd
from pathlib import Path

manifest = sorted(Path('C:/LIDC_DATA').glob('manifest-*'))[0]
metadata = pd.read_csv(manifest / 'metadata.csv')
metadata = metadata[metadata['Modality'].isin(['CT', 'SEG'])].copy()

patient = 'LIDC-IDRI-0112'
patient_data = metadata[metadata['Subject ID'] == patient]

print("="*80)
print(f"PATIENT: {patient}")
print("="*80)

for modality in ['CT', 'SEG']:
    subset = patient_data[patient_data['Modality'] == modality]
    print(f"\n{modality} SERIES ({len(subset)} total):")
    print("-"*80)
    
    for i, row in subset.iterrows():
        print(f"\nSeries #{i+1 if modality=='CT' else i}:")
        print(f"  Description: {row.get('Series Description', 'N/A')}")
        print(f"  Series UID:  {str(row.get('Series UID', 'N/A'))[:50]}")
        print(f"  Study UID:   {str(row.get('Study UID', 'N/A'))[:50]}")

# Check if they share same Study UID
print("\n" + "="*80)
print("STUDY-LEVEL ANALYSIS:")
print("="*80)

ct_subset = patient_data[patient_data['Modality'] == 'CT']
seg_subset = patient_data[patient_data['Modality'] == 'SEG']

ct_study = ct_subset['Study UID'].iloc[0] if len(ct_subset) > 0 else None
seg_studies = set(seg_subset['Study UID'].unique())

print(f"CT Study UID:     {str(ct_study)[:50]}")
print(f"SEG Study UIDs:   {len(seg_studies)} unique")
for s in seg_studies:
    print(f"  - {str(s)[:50]}")

if ct_study in seg_studies:
    print("\n✅ CT and SEGs share SAME Study UID - correctly paired!")
    matching_segs = seg_subset[seg_subset['Study UID'] == ct_study]
    print(f"   SEGs with matching Study UID: {len(matching_segs)}")
else:
    print("\n❌ CT and SEGs have DIFFERENT Study UIDs - NOT properly paired!")

# Show which SEG to use
print("\n" + "="*80)
print("RECOMMENDATION:")
print("="*80)
print("We should use ALL matching SEGs with UNION (OR) operation:")
print(f"  - Current code: takes .iloc[0] (first SEG only)")
print(f"  - Better way: combine all {len(seg_subset)} SEG masks")
print(f"  - Result: consensus from all radiologists ✅")
