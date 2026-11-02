#!/usr/bin/env python3
"""Construit un profil de référence à partir d'un corpus de swings.

Idée : plutôt que d'affirmer à un débutant « ton sway dépasse le seuil », lui
dire « ton sway est à 28 % du torse, là où ce corpus de référence est à 4 % en
médiane et 9 % au 90e centile ». Un centile se comprend sans connaître la
biomécanique, et il rend le jugement vérifiable.

Le vecteur agrégé est celui que produisent les règles elles-mêmes
(`analyze.ts --metrics`) : une valeur scalaire par règle, dans l'unité déjà
documentée. Aucun second jeu de métriques à maintenir en parallèle.

⚠️ Filtrage par qualité : un clip dont la pose est mal détectée produit des
valeurs aberrantes qui décalent les centiles. Les clips sont donc écartés
sur des critères explicites, et le taux de rejet est affiché — c'est lui qui
dira si un corpus en basse résolution est exploitable ou non.

    # voie rapide : un seul processus pour tout le corpus
    npx tsx ../web/scripts/analyze.ts --batch data/points -o data/metrics.jsonl
    python build_reference.py --batch-results data/metrics.jsonl -o profile.json

    # voie simple : un processus par clip (lent au-delà de quelques dizaines)
    python build_reference.py --landmarks-dir data/points -o profile.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

PERCENTILES = [5, 10, 25, 50, 75, 90, 95]


def engine_metrics(points_path: Path) -> dict | None:
    """Appelle le moteur livré et renvoie le vecteur de métriques."""
    try:
        completed = subprocess.run(
            ["npx", "tsx", "scripts/analyze.ts", str(points_path.resolve()), "--metrics"],
            cwd=WEB_DIR,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"  ! {points_path.name} : moteur injoignable ({exc})", file=sys.stderr)
        return None
    out = completed.stdout.strip()
    if not out:
        return None
    try:
        payload = json.loads(out.splitlines()[-1])
    except json.JSONDecodeError:
        return None
    return payload if payload.get("ok") else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--landmarks-dir", type=Path,
                        help="dossier de points clés ; un processus moteur par clip")
    parser.add_argument("--batch-results", type=Path,
                        help="sortie .jsonl de « analyze.ts --batch » ; très préférable "
                             "au-delà de quelques dizaines de clips (un démarrage de "
                             "processus par clip coûte plus cher que l'analyse)")
    parser.add_argument("-o", "--out", type=Path, required=True)
    parser.add_argument(
        "--corpus",
        type=Path,
        help="métadonnées du corpus (corpus.json) : niveau, club, vue par clip",
    )
    parser.add_argument("--label", default="reference", help="nom du corpus dans le profil")
    # Seuils de qualité : un clip en dessous est écarté plutôt que de polluer
    # les centiles. Volontairement stricts — mieux vaut 200 clips propres que
    # 1400 clips bruités.
    parser.add_argument("--min-pose-coverage", type=float, default=0.9)
    parser.add_argument("--min-view-confidence", type=float, default=0.6)
    parser.add_argument("--min-downswing-frames", type=int, default=5)
    parser.add_argument("--min-event-confidence", type=float, default=0.7,
                        help="confiance minimale sur l'adresse et l'impact")
    parser.add_argument("--max-foot-drift", type=float, default=0.10,
                        help="déplacement apparent des chevilles toléré (en U) : "
                             "au-delà, la caméra a bougé et les mesures de "
                             "translation sont contaminées")
    parser.add_argument("--min-samples", type=int, default=20,
                        help="nombre minimal de clips par (vue, métrique) pour publier des centiles")
    args = parser.parse_args()

    if not args.landmarks_dir and not args.batch_results:
        raise SystemExit("Fournis --batch-results (rapide) ou --landmarks-dir.")

    if args.batch_results:
        results = []
        for line in args.batch_results.read_text().splitlines():
            line = line.strip()
            if line:
                results.append(json.loads(line))
    else:
        files = sorted(args.landmarks_dir.glob("*.json"))
        files = [f for f in files if f.name not in {"corpus.json", "labels.json"}]
        if not files:
            raise SystemExit(f"Aucun fichier de points clés dans {args.landmarks_dir}")
        results = [engine_metrics(f) for f in files]

    # values[vue][métrique] = liste de valeurs
    values: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    kept = 0
    rejected: dict[str, int] = defaultdict(int)

    for result in results:
        if result is None or not result.get("ok"):
            rejected["analyse refusée"] += 1
            continue
        if result["view"] == "unknown":
            rejected["vue indéterminée"] += 1
            continue
        if result["poseCoverage"] < args.min_pose_coverage:
            rejected["pose insuffisante"] += 1
            continue
        if result["viewConfidence"] < args.min_view_confidence:
            rejected["vue incertaine"] += 1
            continue
        if result["downswingFrames"] < args.min_downswing_frames:
            rejected["descente trop courte"] += 1
            continue
        conf = result.get("eventConfidence") or {}
        if min(conf.get("address", 1), conf.get("impact", 1)) < args.min_event_confidence:
            rejected["phases peu sûres"] += 1
            continue
        drift = result.get("footDrift")
        if not isinstance(drift, (int, float)):
            rejected["chevilles non visibles"] += 1
            continue
        if drift > args.max_foot_drift:
            rejected["caméra instable"] += 1
            continue

        for metric, value in result["metrics"].items():
            values[result["view"]][metric].append(float(value))
        kept += 1

    total = len(results)
    print(f"\nClips retenus : {kept}/{total} ({kept / total:.0%})")
    for reason, n in sorted(rejected.items(), key=lambda kv: -kv[1]):
        print(f"  écartés — {reason} : {n}")
    if kept == 0:
        raise SystemExit("Aucun clip exploitable : corpus ou qualité de pose à revoir.")

    profile: dict = {
        "label": args.label,
        "clipsAnalysed": total,
        "clipsKept": kept,
        "quality": {
            "minPoseCoverage": args.min_pose_coverage,
            "minViewConfidence": args.min_view_confidence,
            "minDownswingFrames": args.min_downswing_frames,
            "minEventConfidence": args.min_event_confidence,
            "maxFootDrift": args.max_foot_drift,
        },
        "views": {},
    }

    for view, metrics in values.items():
        entry: dict = {}
        for metric, raw in sorted(metrics.items()):
            arr = np.asarray(raw, dtype=float)
            if arr.size < args.min_samples:
                # Publier des centiles sur 5 échantillons serait trompeur.
                print(f"  · {view}/{metric} ignoré : {arr.size} échantillon(s) < {args.min_samples}")
                continue
            entry[metric] = {
                "n": int(arr.size),
                "mean": round(float(arr.mean()), 3),
                "sd": round(float(arr.std(ddof=1)), 3),
                "percentiles": {
                    str(p): round(float(np.percentile(arr, p)), 3) for p in PERCENTILES
                },
            }
        if entry:
            profile["views"][view] = entry

    if not profile["views"]:
        raise SystemExit(
            "Aucune métrique n'atteint le nombre minimal d'échantillons "
            f"({args.min_samples}). Agrandis le corpus ou baisse --min-samples."
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(profile, indent=1, ensure_ascii=False))
    print(f"\n✓ profil → {args.out}")
    for view, metrics in profile["views"].items():
        print(f"\n  {view} ({len(metrics)} métriques)")
        print(f"    {'métrique':<22}{'n':>5}{'p10':>9}{'médiane':>10}{'p90':>9}")
        for metric, stats in metrics.items():
            p = stats["percentiles"]
            print(f"    {metric:<22}{stats['n']:>5}{p['10']:>9}{p['50']:>10}{p['90']:>9}")


if __name__ == "__main__":
    main()
