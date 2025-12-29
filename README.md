<img width="2816" height="1504" alt="LUNGXAİ LOGO" src="https://github.com/user-attachments/assets/31a38582-d823-4d31-a14e-3df083df65ea" /># ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging
AI-Supported Lung Nodule Detection and Classification Using Medical Imaging



---
![Uploading LUNGXAİ LOGO.png…]()

## Repository Structure

```
UI/                    # Frontend interface
models/                # Machine Learning components
└── lung25demo/         # ML pipeline (submodule)
.gitmodules             # Git submodule configuration
Literature Review.docx
README.md
package.json
```

> ⚠️ The `models/lung25demo` directory is a **Git submodule** and must be initialized after cloning.

---

## Clone (First Time)

Recommended way (clone repository **with submodules**):

```bash
git clone --recurse-submodules https://github.com/CankayaUniversity/ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging.git
```

---

## If You Already Cloned the Repository

If the `models/lung25demo` folder is empty or missing:

```bash
git submodule update --init --recursive
```

---

## Pulling Updates

When you pull new changes from the main repository (or switch branches):

```bash
git pull
git submodule update --init --recursive
```

This ensures that submodules are synced to the commit referenced by the main repository.

---

## Submodule Notes

- `models/lung25demo` is managed as a **submodule**.
- Do **not** manually copy files into or out of the submodule directory.
- If the submodule folder appears empty, initialize/update submodules using the commands above.

---

## Common Issues

### Submodule folder is empty

```bash
git submodule update --init --recursive
```

### After switching branches, submodule looks incorrect

```bash
git submodule update --init --recursive
```

### One-line update command

```bash
git pull && git submodule update --init --recursive
```

