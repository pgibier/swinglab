#!/usr/bin/env python3
"""Ajoute l'observation de la balle aux fichiers de points clés d'un corpus.

Même principe que le détecteur embarqué dans l'application : la balle jouée
est ce qui est immobile avant l'impact et absent juste après. Reproduire ici
la même méthode permet de CALIBRER les métriques de position de balle sur le
corpus, avec exactement la mesure que verra l'utilisateur.

    python extract_ball.py --points data/points --clips data/videos_160 \\
        --metrics data/metrics.jsonl
"""

from __future__ import annotations

import argparse
import json
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

MIN_RADIUS_U = 0.012
MAX_RADIUS_U = 0.09
MIN_FILL = 0.45
DEPARTURE_CORR = 0.55


def mean_frames(cap, indices):
    acc, n = None, 0
    for i in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, img = cap.read()
        if not ok:
            continue
        f = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        acc = f if acc is None else acc + f
        n += 1
    return (acc / n) if n >= 3 else None


def detect(job):
    points_path, clip_path, impact = job
    data = json.loads(Path(points_path).read_text())
    frames = data["frames"]
    if impact >= len(frames) or frames[impact] is None:
        return points_path, None

    cap = cv2.VideoCapture(str(clip_path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if impact < 12 or impact + 12 >= total:
        cap.release()
        return points_path, None

    before = mean_frames(cap, range(max(0, impact - 20), impact - 2, 2))
    after = mean_frames(cap, range(impact + 5, min(total, impact + 25), 2))
    if before is None or after is None:
        cap.release()
        return points_path, None

    diff = np.abs(before - after)
    h, w = diff.shape
    lms = frames[impact]
    hip_y = (lms[23]["y"] + lms[24]["y"]) / 2 * h
    sh_y = (lms[11]["y"] + lms[12]["y"]) / 2 * h
    ank_y = (lms[27]["y"] + lms[28]["y"]) / 2 * h
    torso = abs(hip_y - sh_y)
    if torso < 4:
        cap.release()
        return points_path, None

    band = np.zeros_like(diff, dtype=np.uint8)
    band[max(0, int(hip_y)):min(h, int(ank_y + 0.08 * h)), :] = 255
    d = cv2.GaussianBlur(cv2.bitwise_and(diff.astype(np.uint8), band), (3, 3), 0)
    if d.max() < 16:
        cap.release()
        return points_path, None

    _, th = cv2.threshold(d, max(14, int(d.max() * 0.45)), 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in contours:
        area = cv2.contourArea(c)
        if area < 3:
            continue
        (x, y), radius = cv2.minEnclosingCircle(c)
        fill = area / (np.pi * radius * radius + 1e-6)
        if not (MIN_RADIUS_U * torso < radius < MAX_RADIUS_U * torso):
            continue
        if fill < MIN_FILL:
            continue
        peak = float(d[int(y), int(x)])
        if best is None or peak > best[0]:
            best = (peak, x, y, radius, fill)
    if best is None:
        cap.release()
        return points_path, None

    peak, bx, by, radius, fill = best

    # Date du départ, par corrélation d'une vignette avec son état au repos.
    pad = max(3, int(radius * 3))

    def patch(idx):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, img = cap.read()
        if not ok:
            return None
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        y0, y1 = max(0, int(by) - pad), min(h, int(by) + pad)
        x0, x1 = max(0, int(bx) - pad), min(w, int(bx) + pad)
        return g[y0:y1, x0:x1]

    rest = patch(max(0, impact - 20))
    departure = None
    if rest is not None and rest.size > 4:
        for f in range(max(0, impact - 4), min(total, impact + 7)):
            p = patch(f)
            if p is None or p.shape != rest.shape:
                continue
            a, b = p - p.mean(), rest - rest.mean()
            denom = np.sqrt((a * a).sum() * (b * b).sum()) + 1e-6
            if float((a * b).sum() / denom) < DEPARTURE_CORR:
                departure = f
                break
    cap.release()
    if departure is None:
        return points_path, None

    confidence = min(0.95, 0.35 + 0.35 * min(1.0, peak / max(1.0, float(d.max())))
                     + 0.3 * min(1.0, fill / 0.8))
    return points_path, {
        "x": round(float(bx / w), 5),
        "y": round(float(by / h), 5),
        "radius": round(float(radius / h), 5),
        "departureFrame": int(departure),
        "confidence": round(float(confidence), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--points", type=Path, required=True)
    parser.add_argument("--clips", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True,
                        help="sortie de analyze.ts --batch, pour l'impact cinématique")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    impacts = {}
    for line in args.metrics.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r.get("ok") and "events" in r:
            impacts[str(r["id"])] = r["events"]["impact"]

    jobs = []
    for points_path in sorted(args.points.glob("*.json")):
        cid = points_path.stem
        clip = args.clips / f"{cid}.mp4"
        if cid in impacts and clip.exists():
            jobs.append((str(points_path), str(clip), impacts[cid]))

    print(f"{len(jobs)} clips à traiter")
    found = 0
    with Pool(args.workers) as pool:
        for i, (points_path, ball) in enumerate(pool.imap_unordered(detect, jobs, chunksize=4), 1):
            if ball:
                found += 1
                data = json.loads(Path(points_path).read_text())
                data["ball"] = ball
                Path(points_path).write_text(json.dumps(data))
            if i % 100 == 0:
                print(f"  {i}/{len(jobs)} · balle trouvée sur {found} ({found/i:.0%})", flush=True)
    print(f"\n✓ balle détectée sur {found}/{len(jobs)} clips ({found/max(1,len(jobs)):.0%})")


if __name__ == "__main__":
    main()
