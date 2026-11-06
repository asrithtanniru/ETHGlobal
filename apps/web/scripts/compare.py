"""Compare captured screenshots with reference frames from the design recording.

Usage: python3 -I scripts/compare.py REF_DIR CAPTURE_DIR OUT_DIR
For every reference frame NN_name_*.jpg with a matching capture NN_name.png, writes
side-by-side, 50/50 overlay and abs-diff heatmap images, and prints metrics:
  ssim   structural similarity on 1/4-scale grayscale (content text differs by design, so
         treat it as a trend, not a pass mark)
  rules  y positions of full-width dashed rules found in each image, and their deltas
  vrules x positions of vertical dashed guides
  ink    share of dark pixels (layout density) in each image
"""
import glob, json, os, sys
import numpy as np
from PIL import Image

ref_dir, cap_dir, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)


def gray(im, s=4):
    g = im.convert("L")
    return np.asarray(g.resize((g.width // s, g.height // s), Image.BILINEAR)).astype(np.float64)


def ssim(a, b):
    from numpy.lib.stride_tricks import sliding_window_view as sw
    k = 7
    A, B = sw(a, (k, k)), sw(b, (k, k))
    ma, mb = A.mean((-1, -2)), B.mean((-1, -2))
    va, vb = A.var((-1, -2)), B.var((-1, -2))
    cov = ((A - ma[..., None, None]) * (B - mb[..., None, None])).mean((-1, -2))
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    return float((((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma**2 + mb**2 + c1) * (va + vb + c2))).mean())


def hrules(im):
    a = np.asarray(im.convert("L")).astype(int)
    dark = (a[:, 2:74] < 228).sum(1)  # outside the frame only rules cross the gutter
    ys = [y for y in range(a.shape[0]) if dark[y] > 15]
    groups = []
    for y in ys:
        if groups and y - groups[-1][-1] <= 2: groups[-1].append(y)
        else: groups.append([y])
    return [int(np.mean(g)) for g in groups]


def vrules(im, y0=120, y1=None):
    a = np.asarray(im.convert("L")).astype(int)
    y1 = y1 or a.shape[0] - 60
    seg = a[y0:y1]
    dark = ((seg < 228) & (seg > 150)).sum(0)
    xs = [x for x in range(a.shape[1]) if dark[x] > (y1 - y0) * 0.3]
    groups = []
    for x in xs:
        if groups and x - groups[-1][-1] <= 2: groups[-1].append(x)
        else: groups.append([x])
    return [int(np.mean(g)) for g in groups]


report = {}
for ref_path in sorted(glob.glob(os.path.join(ref_dir, "*.jpg"))):
    key = "_".join(os.path.basename(ref_path).split("_")[:2])
    cap_path = os.path.join(cap_dir, key + ".png")
    if not os.path.exists(cap_path):
        continue
    ref = Image.open(ref_path).convert("RGB")
    cap = Image.open(cap_path).convert("RGB").resize(ref.size)
    ga, gb = gray(ref), gray(cap)
    r_rules, c_rules = hrules(ref), hrules(cap)
    m = {
        "ssim": round(ssim(ga, gb), 3),
        "rules_ref": r_rules,
        "rules_cap": c_rules,
        "vrules_ref": vrules(ref),
        "vrules_cap": vrules(cap),
        "ink_ref": round(float((ga < 128).mean()), 4),
        "ink_cap": round(float((gb < 128).mean()), 4),
        "bg_ref": "#%02x%02x%02x" % tuple(np.median(np.asarray(ref)[300:320, 20:60].reshape(-1, 3), 0).astype(int)),
        "bg_cap": "#%02x%02x%02x" % tuple(np.median(np.asarray(cap)[300:320, 20:60].reshape(-1, 3), 0).astype(int)),
    }
    report[key] = m
    side = Image.new("RGB", (ref.width * 2, ref.height), "white")
    side.paste(ref, (0, 0)); side.paste(cap, (ref.width, 0))
    side.resize((ref.width, ref.height // 2)).save(os.path.join(out_dir, f"{key}_side.jpg"), quality=82)
    Image.blend(ref, cap, 0.5).save(os.path.join(out_dir, f"{key}_overlay.jpg"), quality=82)
    d = np.abs(np.asarray(ref).astype(int) - np.asarray(cap).astype(int)).mean(2)
    heat = np.zeros((*d.shape, 3), np.uint8); heat[..., 0] = np.clip(d * 3, 0, 255); heat[..., 1] = np.clip(d * 1.2, 0, 255)
    Image.fromarray(heat).save(os.path.join(out_dir, f"{key}_diff.jpg"), quality=82)
    print(f"{key:18s} ssim={m['ssim']:.3f} rules ref={r_rules} cap={c_rules} vr ref={m['vrules_ref']} cap={m['vrules_cap']} bg {m['bg_ref']}/{m['bg_cap']}")

json.dump(report, open(os.path.join(out_dir, "metrics.json"), "w"), indent=1)
