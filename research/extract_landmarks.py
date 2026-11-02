#!/usr/bin/env python3
"""Extrait les points clés d'une vidéo au format consommé par le moteur TypeScript.

Pourquoi passer par Python ici alors que l'application fait tout dans le
navigateur : pour la VALIDATION en lot. Mesurer la détection de phases sur des
centaines de clips GolfDB n'a pas sa place dans un onglet Chrome.

Le JSON produit est exactement celui qu'attend `web/scripts/analyze.ts`, donc
les règles évaluées sont celles qui sont réellement livrées — il n'existe
qu'une seule implémentation du moteur.

    python extract_landmarks.py swing.mp4 --model pose_landmarker_full.task -o points.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

LANDMARK_COUNT = 33


def extract(video_path: Path, model_path: Path, max_frames: int | None = None) -> dict:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise SystemExit(f"Vidéo illisible : {video_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_segmentation_masks=False,
    )

    frames: list[list[dict] | None] = []
    timestamps: list[float] = []

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        index = 0
        while True:
            ok, frame_bgr = capture.read()
            if not ok:
                break
            if max_frames is not None and index >= max_frames:
                break

            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            # MediaPipe exige des timestamps strictement croissants en mode VIDEO.
            timestamp_ms = int(index * 1000 / fps)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.pose_landmarks:
                lms = result.pose_landmarks[0]
                frames.append(
                    [
                        {
                            "x": lm.x,
                            "y": lm.y,
                            "z": lm.z,
                            # `visibility` peut être absent selon la version.
                            "visibility": getattr(lm, "visibility", None) or 1.0,
                        }
                        for lm in lms[:LANDMARK_COUNT]
                    ]
                )
            else:
                frames.append(None)

            timestamps.append(index / fps)
            index += 1

    capture.release()
    return {
        "fps": fps,
        "videoWidth": width,
        "videoHeight": height,
        "timestamps": timestamps,
        "frames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--model", type=Path, required=True, help="fichier .task de Pose Landmarker")
    parser.add_argument("-o", "--out", type=Path, help="JSON de sortie (stdout par défaut)")
    parser.add_argument("--max-frames", type=int, default=None)
    args = parser.parse_args()

    if not args.model.exists():
        raise SystemExit(
            f"Modèle absent : {args.model}\n"
            "Télécharge-le, par exemple :\n"
            "  curl -LO https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
        )

    data = extract(args.video, args.model, args.max_frames)
    detected = sum(1 for f in data["frames"] if f is not None)
    total = len(data["frames"])
    coverage = detected / total if total else 0.0
    print(
        f"{args.video.name} : {total} images à {data['fps']:.1f} i/s, "
        f"pose trouvée sur {coverage:.0%}",
        file=sys.stderr,
    )

    payload = json.dumps(data)
    if args.out:
        args.out.write_text(payload)
    else:
        print(payload)


if __name__ == "__main__":
    main()
