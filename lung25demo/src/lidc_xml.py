import os
import numpy as np
from lxml import etree

def _xpath(node, expr):
    """Namespace bağımsız XPath helper."""
    return node.xpath(expr)

def parse_lidc_xml_rois(xml_path: str):
    """
    LIDC XML parser (namespace-robust).
    Returns list of nodules:
      {
        "nodule_id": str,
        "roi_z_positions": [float, ...],
        "all_points": [ (z, x, y), ... ]
      }
    """
    if not xml_path or (not os.path.isfile(xml_path)):
        return []

    try:
        parser = etree.XMLParser(recover=True, huge_tree=True)
        tree = etree.parse(xml_path, parser)
        root = tree.getroot()
    except Exception:
        return []

    # Namespace farklarına dayanıklı: local-name() ile ara
    nodule_nodes = _xpath(root, ".//*[local-name()='unblindedReadNodule']")
    out = []

    for i, nn in enumerate(nodule_nodes):
        nodule_id_nodes = _xpath(nn, ".//*[local-name()='noduleID']/text()")
        nodule_id = nodule_id_nodes[0].strip() if nodule_id_nodes else f"nodule_{i}"

        roi_nodes = _xpath(nn, ".//*[local-name()='roi']")
        z_list = []
        pts = []

        for roi in roi_nodes:
            z_txts = _xpath(roi, ".//*[local-name()='imageZposition']/text()")
            if not z_txts:
                z_txts = _xpath(roi, ".//*[local-name()='imageZPosition']/text()")
            if not z_txts:
                continue

            try:
                z = float(str(z_txts[0]).strip())
            except Exception:
                continue

            z_list.append(z)

            # edgeMap points
            edge_maps = _xpath(roi, ".//*[local-name()='edgeMap']")
            for em in edge_maps:
                x_txts = _xpath(em, ".//*[local-name()='xCoord']/text()")
                y_txts = _xpath(em, ".//*[local-name()='yCoord']/text()")
                if not x_txts or not y_txts:
                    continue
                try:
                    x = int(float(str(x_txts[0]).strip()))
                    y = int(float(str(y_txts[0]).strip()))
                    pts.append((z, x, y))
                except Exception:
                    continue

        z_list = sorted(list(set(z_list)))
        out.append({
            "nodule_id": str(nodule_id),
            "roi_z_positions": z_list,
            "all_points": pts,
        })

    return out

def map_roi_z_to_slice_indices(roi_z_positions, dicom_z_positions: np.ndarray, max_dist=10.0):
    """
    Map XML ROI z positions -> nearest DICOM slice indices.
    max_dist artırıldı (demo için daha toleranslı).
    """
    if dicom_z_positions is None or len(dicom_z_positions) == 0:
        return []

    Z = len(dicom_z_positions)
    out = set()

    for z in roi_z_positions:
        idx = int(np.argmin(np.abs(dicom_z_positions - z)))
        dist = float(np.abs(dicom_z_positions[idx] - z))
        # tolerans içinde ise ekle, değilse de nearest’i ekliyoruz (bazı serilerde z meta sapıyor)
        if dist <= max_dist:
            out.add(idx)
        else:
            out.add(idx)

    out = sorted([int(np.clip(i, 0, Z - 1)) for i in out])
    return out
