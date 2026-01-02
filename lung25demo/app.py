import os
import zipfile
import tempfile
import gradio as gr

from src.inference import run_inference

DEFAULT_WEIGHTS = os.environ.get("WEIGHTS_PATH", "outputs/best_resnet18.pt")
DEFAULT_BACKBONE = os.environ.get("BACKBONE", "resnet18")


def extract_zip_to_tmp(zip_file_path: str):
    tmpdir = tempfile.mkdtemp()
    with zipfile.ZipFile(zip_file_path, "r") as zf:
        zf.extractall(tmpdir)
    return tmpdir


def find_series_dir(extracted_root: str):
    """
    Heuristic: return directory that contains most .dcm files.
    """
    best_dir = None
    best_cnt = 0
    for root, _, files in os.walk(extracted_root):
        cnt = sum(1 for f in files if f.lower().endswith(".dcm"))
        if cnt > best_cnt:
            best_cnt = cnt
            best_dir = root
    if best_dir is None or best_cnt == 0:
        raise RuntimeError("Zip içinde DICOM (.dcm) bulamadım.")
    return best_dir


def ui_run(zip_file, auto_best, slice_index, return_base64):
    if zip_file is None:
        return None, "{}"

    # gr.File sometimes returns a tempfile object with `.name`
    zip_path = getattr(zip_file, "name", zip_file)

    extracted = extract_zip_to_tmp(zip_path)
    series_dir = find_series_dir(extracted)

    if not os.path.isfile(DEFAULT_WEIGHTS):
        raise RuntimeError(
            f"Model weights bulunamadı: {DEFAULT_WEIGHTS}. "
            f"outputs/ içine ekle veya WEIGHTS_PATH environment ayarla."
        )

    out, overlay_img, probs = run_inference(
        series_path=series_dir,
        weights_path=DEFAULT_WEIGHTS,
        backbone=DEFAULT_BACKBONE,
        cache_dir="cache",
        slice_index=None if auto_best else int(slice_index),
        auto_best=bool(auto_best),
        return_base64=bool(return_base64),
        out_dir="outputs",
    )
    return overlay_img, out


with gr.Blocks() as demo:
    gr.Markdown("# LIDC 2.5D Slice-level Malignancy + Grad-CAM (DICOM)")

    with gr.Row():
        zip_in = gr.File(label="Upload DICOM ZIP (.zip)", file_types=[".zip"])
        auto_best = gr.Checkbox(value=True, label="Auto best slice (highest prob)")

    slice_idx = gr.Slider(0, 400, value=50, step=1, label="Slice index (auto kapalıysa kullanılır)")
    return_b64 = gr.Checkbox(value=False, label="Return heatmap as base64 in JSON (optional)")

    run_btn = gr.Button("Run inference")

    with gr.Row():
        img_out = gr.Image(label="Grad-CAM Overlay", type="pil")
        json_out = gr.JSON(label="Output JSON")

    run_btn.click(
        fn=ui_run,
        inputs=[zip_in, auto_best, slice_idx, return_b64],
        outputs=[img_out, json_out],
    )


if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", server_port=7861)
