#!/usr/bin/env python3
"""Mesure la qualité de la détection des phases du swing contre une vérité terrain.

Le moteur évalué est celui qui est LIVRÉ : ce script appelle
`web/scripts/analyze.ts`. Il n'existe donc aucun risque de valider une
implémentation et d'en expédier une autre.

Trois modes :
  --batch-results  sortie .jsonl de « analyze.ts --batch » — de loin le plus
                   rapide, et le seul tenable au-delà de quelques dizaines de
                   clips (un démarrage de processus par clip coûte plus cher
                   que l'analyse)
  --landmarks-dir  points clés déjà extraits (JSON), un processus par clip
  --videos-dir     vidéos brutes, extraction MediaPipe à la volée

Le fichier de labels suit le format produit par golfdb_labels.py :
  {"clips": [{"id": 42, "events": {"address": 12, "top": 48, ...}}, ...]}
Seules les phases présentes dans les labels sont comparées.

    python validate_events.py --labels data/labels.json --landmarks-dir data/points
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

EVENT_NAMES = [
    "address",
    "toeUp",
    "midBackswing",
    "top",
    "midDownswing",
    "impact",
    "midFollowThrough",
    "finish",
]

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def run_engine(points_path: Path) -> dict | None:
    """Appelle le moteur TypeScript et renvoie les phases détectées."""
    try:
        completed = subprocess.run(
            ["npx", "tsx", "scripts/analyze.ts", str(points_path.resolve()), "--events"],
            cwd=WEB_DIR,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"  ! {points_path.name} : moteur injoignable ({exc})", file=sys.stderr)
        return None

    stdout = completed.stdout.strip()
    if not stdout:
        print(f"  ! {points_path.name} : aucune sortie ({completed.stderr.strip()[:160]})", file=sys.stderr)
        return None
    try:
        payload = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError:
        print(f"  ! {points_path.name} : sortie illisible ({stdout[:160]})", file=sys.stderr)
        return None
    if not payload.get("ok"):
        return None
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--batch-results", type=Path,
                        help="sortie .jsonl de « analyze.ts --batch »")
    parser.add_argument("--landmarks-dir", type=Path)
    parser.add_argument("--videos-dir", type=Path)
    parser.add_argument("--model", type=Path, help="fichier .task, requis avec --videos-dir")
    parser.add_argument(
        "--tolerance",
        type=int,
        default=3,
        help="écart maximal en images pour compter une phase comme correcte "
        "(GolfDB publie son PCE avec sa propre définition de tolérance : "
        "les chiffres ne sont comparables qu'à tolérance identique)",
    )
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if not args.batch_results and not args.landmarks_dir and not args.videos_dir:
        raise SystemExit("Fournis --batch-results, --landmarks-dir ou --videos-dir.")
    if args.videos_dir and not args.model:
        raise SystemExit("--videos-dir requiert --model.")

    clips = json.loads(args.labels.read_text())["clips"]
    if args.limit:
        clips = clips[: args.limit]

    # Mode corpus : tout est déjà analysé, il ne reste qu'à comparer.
    if args.batch_results:
        detected_by_id: dict[str, dict] = {}
        for line in args.batch_results.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("ok") and "events" in row:
                detected_by_id[str(row["id"])] = row

        errors: dict[str, list[int]] = {name: [] for name in EVENT_NAMES}
        signed: dict[str, list[int]] = {name: [] for name in EVENT_NAMES}
        evaluated = 0
        missing = 0
        for clip in clips:
            row = detected_by_id.get(str(clip["id"]))
            if row is None:
                missing += 1
                continue
            for name, truth in clip["events"].items():
                if name not in row["events"]:
                    continue
                delta = int(row["events"][name]) - int(truth)
                errors[name].append(abs(delta))
                signed[name].append(delta)
            evaluated += 1

        if evaluated == 0:
            raise SystemExit(f"Aucun clip évalué ({missing} absent(s)).")

        print(f"\nClips évalués : {evaluated}  (absents : {missing})")
        print(f"Tolérance     : ±{args.tolerance} image(s)\n")
        print(f"{'phase':<20}{'n':>6}{'correct':>10}{'err. moy.':>12}{'médiane':>10}{'biais':>9}")
        print("-" * 67)
        all_errors: list[int] = []
        for name in EVENT_NAMES:
            values = errors[name]
            if not values:
                print(f"{name:<20}{0:>6}{'—':>10}{'—':>12}{'—':>10}{'—':>9}")
                continue
            arr = np.asarray(values)
            bias = float(np.median(signed[name]))
            within = float((arr <= args.tolerance).mean())
            print(f"{name:<20}{len(arr):>6}{within:>9.1%}{arr.mean():>11.2f}f"
                  f"{np.median(arr):>9.1f}f{bias:>+8.1f}f")
            all_errors.extend(values)
        overall = np.asarray(all_errors)
        print("-" * 67)
        print(f"{'TOUTES PHASES':<20}{len(overall):>6}"
              f"{float((overall <= args.tolerance).mean()):>9.1%}"
              f"{overall.mean():>11.2f}f{np.median(overall):>9.1f}f")
        print("\nLa colonne « biais » est l'écart médian SIGNÉ (détecté − annoté) :")
        print("un biais systématique se corrige, du bruit non.")
        return

    work_dir = args.landmarks_dir or (args.videos_dir.parent / "_points")
    if args.videos_dir:
        work_dir.mkdir(parents=True, exist_ok=True)

    errors: dict[str, list[int]] = {name: [] for name in EVENT_NAMES}
    evaluated = 0
    missing = 0
    refused = 0

    for clip in clips:
        clip_id = clip["id"]
        points_path = work_dir / f"{clip_id}.json"

        if args.videos_dir and not points_path.exists():
            candidates = list(args.videos_dir.glob(f"{clip_id}.*"))
            if not candidates:
                missing += 1
                continue
            subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).parent / "extract_landmarks.py"),
                    str(candidates[0]),
                    "--model",
                    str(args.model),
                    "-o",
                    str(points_path),
                ],
                check=True,
            )

        if not points_path.exists():
            missing += 1
            continue

        result = run_engine(points_path)
        if result is None:
            refused += 1
            continue

        detected = result["events"]
        for name, truth in clip["events"].items():
            if name not in detected:
                continue
            errors[name].append(abs(int(detected[name]) - int(truth)))
        evaluated += 1

    if evaluated == 0:
        raise SystemExit(
            f"Aucun clip évalué ({missing} absent(s), {refused} refusé(s) par le moteur)."
        )

    print(f"\nClips évalués : {evaluated}  (absents : {missing}, refusés : {refused})")
    print(f"Tolérance     : ±{args.tolerance} image(s)\n")
    print(f"{'phase':<20}{'n':>5}{'correct':>10}{'err. moy.':>12}{'médiane':>10}{'p90':>8}")
    print("-" * 65)

    all_errors: list[int] = []
    for name in EVENT_NAMES:
        values = errors[name]
        if not values:
            print(f"{name:<20}{0:>5}{'—':>10}{'—':>12}{'—':>10}{'—':>8}")
            continue
        arr = np.asarray(values)
        within = float((arr <= args.tolerance).mean())
        print(
            f"{name:<20}{len(arr):>5}{within:>9.1%}{arr.mean():>11.2f}f"
            f"{np.median(arr):>9.1f}f{np.percentile(arr, 90):>7.1f}f"
        )
        all_errors.extend(values)

    overall = np.asarray(all_errors)
    print("-" * 65)
    print(
        f"{'TOUTES PHASES':<20}{len(overall):>5}"
        f"{float((overall <= args.tolerance).mean()):>9.1%}"
        f"{overall.mean():>11.2f}f{np.median(overall):>9.1f}f"
        f"{np.percentile(overall, 90):>7.1f}f"
    )


if __name__ == "__main__":
    main()
