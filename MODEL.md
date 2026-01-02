# Core Model Ownership & Source of Truth

The core lung nodule detection model is **designed, implemented, and maintained by Furkan (fc63)**.

## Source of Truth
- **Repository:** https://github.com/fc63/Pulmo
- **Location in this project:** `ai/Pulmo` (git submodule)
- **Active branch:** `v1`

The `ai/Pulmo` directory is treated as a **read-only submodule** in this repository.
All core model development happens **only** in the Pulmo repository.

## Development Policy
- The core model is **not duplicated** in this repository.
- Changes to the model must **not** be committed directly here.
- Any proposed modification must be submitted as:
  - a patch, or
  - a pull request to the Pulmo repository (upon approval).

## Rationale
This separation ensures:
- clear ownership of the model,
- reproducible research,
- controlled and reviewable model evolution.
