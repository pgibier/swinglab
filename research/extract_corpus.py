#!/usr/bin/env python3
"""Extraction de pose sur tout un corpus, en parallèle et reprenable.

Pensé pour l'échelle : 1 000 clips d'environ 220 images font plus de 200 000
inférences, soit plus de deux heures sur un seul cœur. Le travail est donc
réparti sur plusieurs processus — chacun avec son propre détecteur, MediaPipe
n'étant pas partageable entre processus.

Reprenable : un clip déjà extrait est ignoré. Une interruption ne coûte que le
clip en cours.

    python extract_corpus.py --labels data/labels.json \\
        --clips-dir data/videos_160 --model pose_landmarker_full.task \\
        -o data/points --views face-on down-the-line --workers 4
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

LANDMARK_COUNT = 33

_MODEL_PATH = None


def _init(model_path: str) -> None:
    global _MODEL_PATH
    _MODEL_PATH = model_path
    # Réduit le bruit de log des sous-processus.
    os.environ.setdefault("GLOG_minloglevel", "2")


def _new_landmarker():
    """Un détecteur NEUF par clip.

    Deux raisons, et la première est une erreur rencontrée : en mode VIDEO,
    MediaPipe exige des horodatages strictement croissants sur toute la durée
    de vie du détecteur. Réutiliser la même instance d'un clip à l'autre, dont
    les horodatages repartent de zéro, lève
    « Input timestamp must be monotonically increasing ».

    La seconde est plus importante : le mode VIDEO entretient un suivi
    temporel. Garder ce suivi d'un clip au suivant ferait fuiter la pose du
    joueur précédent dans les premières images du suivant.

    Le coût est négligeable — mesuré sous 0,1 s, contre ~0,025 s par image.
    """
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=_MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_segmentation_masks=False,
    )
    return vision.PoseLandmarker.create_from_options(options)


def extract_one(job: tuple[str, str, str]) -> tuple[str, bool, float, int]:
    clip_path, out_path, _ = job
    import cv2
    import mediapipe as mp

    capture = cv2.VideoCapture(clip_path)
    if not capture.isOpened():
        return (clip_path, False, 0.0, 0)

    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frames: list[list[dict] | None] = []
    index = 0
    detected = 0
    with _new_landmarker() as landmarker:
        while True:
            ok, bgr = capture.read()
            if not ok:
                break
            image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB),
            )
            result = landmarker.detect_for_video(image, int(index * 1000 / fps))
            if result.pose_landmarks:
                detected += 1
                lms = result.pose_landmarks[0][:LANDMARK_COUNT]
                frames.append([
                    {
                        # 4 décimales suffisent : c'est déjà sous le pixel sur
                        # une image de 160 px, et cela divise la taille des
                        # fichiers par deux.
                        "x": round(float(lm.x), 4),
                        "y": round(float(lm.y), 4),
                        "z": round(float(lm.z), 4),
                        "visibility": round(float(getattr(lm, "visibility", None) or 1.0), 3),
                    }
                    for lm in lms
                ])
            else:
                frames.append(None)
            index += 1
    capture.release()

    if index == 0:
        return (clip_path, False, 0.0, 0)

    Path(out_path).write_text(json.dumps({
        "fps": fps,
        "videoWidth": width,
        "videoHeight": height,
        "timestamps": [round(i / fps, 5) for i in range(index)],
        "frames": frames,
    }))
    return (clip_path, True, detected / index, index)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--clips-dir", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("-o", "--out-dir", type=Path, required=True)
    parser.add_argument("--views", nargs="*", default=["face-on", "down-the-line"],
                        help="vues à traiter ; « other » est inutile au moteur")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2)))
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    clips = json.loads(args.labels.read_text())["clips"]
    if args.views:
        clips = [c for c in clips if c["view"] in args.views]
    if args.limit:
        clips = clips[: args.limit]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    skipped = 0
    missing = 0
    for clip in clips:
        src = args.clips_dir / f"{clip['id']}.mp4"
        dst = args.out_dir / f"{clip['id']}.json"
        if not src.exists():
            missing += 1
            continue
        if dst.exists() and dst.stat().st_size > 1000:
            skipped += 1
            continue
        jobs.append((str(src), str(dst), str(args.model)))

    print(f"{len(clips)} clips retenus · {len(jobs)} à extraire · "
          f"{skipped} déjà faits · {missing} absents", flush=True)
    if not jobs:
        return

    started = time.time()
    done = 0
    failures = 0
    coverage_sum = 0.0
    frames_total = 0

    with Pool(args.workers, initializer=_init, initargs=(str(args.model),)) as pool:
        for _path, ok, coverage, frames in pool.imap_unordered(extract_one, jobs, chunksize=4):
            done += 1
            if ok:
                coverage_sum += coverage
                frames_total += frames
            else:
                failures += 1
            if done % 25 == 0 or done == len(jobs):
                elapsed = time.time() - started
                rate = done / elapsed
                remaining = (len(jobs) - done) / rate if rate > 0 else 0
                print(
                    f"  {done}/{len(jobs)} · {frames_total} images · "
                    f"couverture moy. {coverage_sum / max(1, done - failures):.1%} · "
                    f"{rate:.2f} clips/s · reste ~{remaining / 60:.0f} min",
                    flush=True,
                )

    print(f"\n✓ {done - failures} extraits, {failures} en échec, "
          f"{frames_total} images en {(time.time() - started) / 60:.1f} min")


if __name__ == "__main__":
    main()
