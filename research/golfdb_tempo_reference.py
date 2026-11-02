#!/usr/bin/env python3
"""Profil de référence du TEMPO, mesuré sur les professionnels de GolfDB.

Particularité : le tempo est le seul indicateur du moteur calculable à partir
des SEULES annotations (des numéros d'images), sans ouvrir une vidéo. C'est un
ratio de durées, donc invariant à la cadence d'enregistrement — vérifiable sur
le corpus lui-même : médiane 3,43 sur les clips en temps réel contre 3,38 sur
les clips en ralenti.

Portée juridique : on n'extrait ici aucune image ni aucun contenu vidéo, mais
des statistiques agrégées calculées sur des numéros d'images. Le dépôt GolfDB
n'énonce aucune licence pour ses annotations ; avant un usage commercial,
faire valider ce point.

Limite assumée : les phases viennent de l'annotation HUMAINE de GolfDB, pas du
détecteur de l'application. Un écart systématique entre les deux reste
possible tant qu'on n'a pas fait tourner le moteur sur les mêmes clips. Ce
n'est mesurable qu'avec les vidéos.

    python golfdb_tempo_reference.py labels.json -o ../web/public/reference/profile.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

PERCENTILES = [5, 10, 25, 50, 75, 90, 95]

# GolfDB nomme ses vues autrement que le moteur ; « other » est écarté.
VIEW_MAP = {"face-on": "face_on", "down-the-line": "down_the_line"}

# Garde-fous : une montée de 2 images ou une descente de 1 image trahit une
# annotation douteuse, pas un swing.
MIN_BACKSWING_FRAMES = 3
MIN_DOWNSWING_FRAMES = 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path, help="sortie de golfdb_labels.py")
    parser.add_argument("-o", "--out", type=Path, required=True)
    parser.add_argument("--min-samples", type=int, default=50)
    args = parser.parse_args()

    clips = json.loads(args.labels.read_text())["clips"]
    by_view: dict[str, list[float]] = {}
    skipped = 0

    for clip in clips:
        view = VIEW_MAP.get(clip["view"])
        if view is None:
            skipped += 1
            continue
        events = clip["events"]
        backswing = events["top"] - events["address"]
        downswing = events["impact"] - events["top"]
        if backswing < MIN_BACKSWING_FRAMES or downswing < MIN_DOWNSWING_FRAMES:
            skipped += 1
            continue
        by_view.setdefault(view, []).append(backswing / downswing)

    views: dict[str, dict] = {}
    for view, values in by_view.items():
        arr = np.asarray(values, dtype=float)
        if arr.size < args.min_samples:
            print(f"· {view} ignoré : {arr.size} échantillon(s)")
            continue
        views[view] = {
            "tempo": {
                "n": int(arr.size),
                "mean": round(float(arr.mean()), 3),
                "sd": round(float(arr.std(ddof=1)), 3),
                "percentiles": {
                    str(p): round(float(np.percentile(arr, p)), 3) for p in PERCENTILES
                },
            }
        }

    if not views:
        raise SystemExit("Aucune vue exploitable.")

    total = sum(v["tempo"]["n"] for v in views.values())
    profile = {
        "label": f"{total} swings de pros (GolfDB)",
        "note": (
            "Tempo uniquement. Mesuré sur les phases annotées à la main de GolfDB, "
            "pas sur le détecteur de l'application : un léger écart systématique "
            "reste possible. Les autres indicateurs n'ont pas encore de référence."
        ),
        "clipsAnalysed": len(clips),
        "clipsKept": total,
        "views": views,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(profile, indent=1, ensure_ascii=False))
    print(f"✓ profil → {args.out}  ({total} swings, {skipped} écartés)")
    for view, metrics in views.items():
        p = metrics["tempo"]["percentiles"]
        print(f"  {view:<16} n={metrics['tempo']['n']:<5} p10 {p['10']}  médiane {p['50']}  p90 {p['90']}")


if __name__ == "__main__":
    main()
