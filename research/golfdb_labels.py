#!/usr/bin/env python3
"""Convertit les annotations GolfDB (golfDB.mat) en labels.json exploitables.

⚠️ LICENCE : GolfDB est distribué sous CC BY-NC 4.0 — usage NON COMMERCIAL.
Ce jeu de données sert ici uniquement à MESURER la qualité de la détection de
phases. Aucun poids entraîné sur GolfDB, et aucune de ses vidéos, ne doit être
embarqué dans l'application livrée.

Source : https://github.com/wmcnally/golfdb (McNally et al., CVPRW 2019)

Structure attendue de golfDB.mat, telle que documentée par le dépôt : un
tableau de structures avec, entre autres, les champs `id`, `youtube_id`,
`player`, `sex`, `club`, `view`, `slow`, `events`, `bbox`, `split`.
Le champ `events` contient 10 valeurs : [début, 8 phases, fin], exprimées en
numéros d'images de la vidéo d'origine. Les clips prétraités étant rognés sur
[début, fin], les phases relatives au clip valent events[1:9] - events[0].

    python golfdb_labels.py data/golfDB.mat -o data/labels.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.io import loadmat

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


def _scalar(value):
    """Déplie les tableaux imbriqués que produit loadmat."""
    arr = np.asarray(value).squeeze()
    if arr.ndim == 0:
        item = arr.item()
        return item
    return arr


def load(mat_path: Path) -> list[dict]:
    raw = loadmat(str(mat_path), squeeze_me=True, struct_as_record=False)
    candidates = [v for k, v in raw.items() if not k.startswith("__")]
    if not candidates:
        raise SystemExit(f"Aucune donnée dans {mat_path}")

    entries = np.atleast_1d(candidates[0])
    records: list[dict] = []
    skipped = 0

    for entry in entries:
        try:
            events = np.asarray(_scalar(entry.events), dtype=float).ravel()
            if events.size < 10:
                skipped += 1
                continue
            start = int(events[0])
            frames = [int(e) - start for e in events[1:9]]
            # Une annotation dont les phases ne sont pas croissantes est inutilisable.
            if any(b <= a for a, b in zip(frames, frames[1:])):
                skipped += 1
                continue
            records.append(
                {
                    "id": int(_scalar(entry.id)),
                    "youtube_id": str(_scalar(entry.youtube_id)),
                    "view": str(_scalar(entry.view)),
                    "slow": int(_scalar(entry.slow)),
                    "club": str(_scalar(entry.club)),
                    "split": int(_scalar(entry.split)) if hasattr(entry, "split") else None,
                    "frame_count": int(events[9]) - start,
                    "events": dict(zip(EVENT_NAMES, frames)),
                }
            )
        except AttributeError as exc:
            raise SystemExit(
                f"Champ manquant dans golfDB.mat ({exc}). "
                "Vérifie que le fichier provient bien de github.com/wmcnally/golfdb."
            ) from exc

    if skipped:
        print(f"· {skipped} annotation(s) ignorée(s) (phases incomplètes ou non ordonnées)")
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mat", type=Path, help="chemin de golfDB.mat")
    parser.add_argument("-o", "--out", type=Path, required=True)
    parser.add_argument(
        "--view",
        choices=["face-on", "down-the-line", "other", "all"],
        default="all",
        help="ne garder que les clips d'une vue",
    )
    args = parser.parse_args()

    records = load(args.mat)
    if args.view != "all":
        records = [r for r in records if r["view"] == args.view]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"clips": records}, indent=1))
    print(f"✓ {len(records)} clips → {args.out}")


if __name__ == "__main__":
    main()
