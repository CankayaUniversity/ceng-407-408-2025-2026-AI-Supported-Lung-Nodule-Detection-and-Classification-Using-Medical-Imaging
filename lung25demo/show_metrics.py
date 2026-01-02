import json

with open("outputs/history_resnet18_ag.json", "r", encoding="utf-8") as f:
    d = json.load(f)

print("epoch  val_acc  val_auc")
for r in d:
    print(f"{r['epoch']:>5}  {r['val_acc']:.4f}  {r['val_auc']:.4f}")

best = max(d, key=lambda r: r["val_auc"])
print("\nBEST EPOCH:", best["epoch"], "VAL_AUC:", best["val_auc"], "VAL_ACC:", best["val_acc"])
