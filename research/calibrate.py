#!/usr/bin/env python3
"""Outils de calibration : mesurer, puis caler les seuils sur un corpus.

Le principe qui gouverne tout ce fichier : un seuil plausible n'est pas un
seuil juste. Avant calage, six règles sur douze se déclenchaient sur plus d'un
quart des professionnels du corpus — la stabilité de tête sur 84 % d'entre
eux. Seule la mesure le dit.

Quatre commandes, à lancer sur la sortie de « analyze.ts --batch » :

    python calibrate.py firing   metrics.jsonl
        Taux de déclenchement de chaque règle. Une règle qui se déclenche
        souvent sur de bons joueurs est mal calée.

    python calibrate.py suggest  metrics.jsonl
        Seuils proposés depuis les centiles : « léger » au 90e, « important »
        au 98e.

    python calibrate.py clubs    metrics.jsonl --labels labels.json
        Quelles métriques dépendent du club, et de combien.

    python calibrate.py club-config metrics.jsonl --labels labels.json
        Bloc TypeScript des surcharges par famille de club.

Filtres de propreté (identiques à build_reference.py) : pose détectée, vue
identifiée, phases sûres, et caméra stable. Ce dernier est décisif — 32 % des
clips du corpus dépassent 10 % de dérive, et les inclure faussait les
centiles.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

# Sens de chaque métrique : 'up' = mauvais quand ça monte, 'down' = mauvais
# quand ça descend, 'band' = zone saine au milieu.
DIRECTION = {
    "head_movement": "up", "sway": "up", "slide": "up", "early_extension": "up",
    "loss_of_posture": "up", "reverse_pivot": "up", "finish_balance": "up",
    "chicken_wing": "down",
    "setup_spine_tilt": "band", "setup_knee_flex": "band",
    "setup_stance_width": "band", "tempo": "band",
}
# Métriques exprimées en % du torse par le moteur, stockées en U dans la config.
PERCENT = {"head_movement", "sway", "slide", "early_extension", "finish_balance"}
TS_NAME = {
    "setup_spine_tilt": "setupSpineTilt", "setup_knee_flex": "setupKneeFlex",
    "setup_stance_width": "setupStanceWidth", "sway": "sway", "slide": "slide",
    "reverse_pivot": "reversePivot", "head_movement": "headMovement",
    "loss_of_posture": "lossOfPosture", "early_extension": "earlyExtension",
    "chicken_wing": "chickenWing", "tempo": "tempo", "finish_balance": "finishBalance",
}
CLUB_GROUP = {"driver": "driver", "fairway": "wood", "hybrid": "wood",
              "iron": "iron", "wedge": "wedge"}
MIN_GROUP_N = 20
MIN_CLUB_EFFECT = 0.3


def load(path: Path, *, clean: bool) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    rows = [r for r in rows if r.get("ok")]
    if not clean:
        return rows
    kept = [
        r for r in rows
        if r["view"] != "unknown"
        and r["poseCoverage"] >= 0.9
        and r["viewConfidence"] >= 0.6
        and r["downswingFrames"] >= 5
        and r.get("eventConfidence", {}).get("address", 0) >= 0.7
        and r.get("eventConfidence", {}).get("impact", 0) >= 0.7
        and isinstance(r.get("footDrift"), (int, float))
        and r["footDrift"] <= 0.10
    ]
    print(f"filtrage : {len(rows)} → {len(kept)} swings ({len(kept)/max(1,len(rows)):.0%} retenus)\n")
    return kept


def collect(rows: list[dict]) -> dict[str, np.ndarray]:
    vals = defaultdict(list)
    for r in rows:
        for k, v in r["metrics"].items():
            vals[k].append(v)
    return {k: np.asarray(v, dtype=float) for k, v in vals.items()}


def cmd_firing(rows: list[dict]) -> None:
    by_rule = defaultdict(lambda: {"n": 0, "sev": Counter(), "vals": []})
    for r in rows:
        for rule, sev in (r.get("severities") or {}).items():
            entry = by_rule[rule]
            entry["n"] += 1
            entry["sev"][sev] += 1
            if rule in r["metrics"]:
                entry["vals"].append(r["metrics"][rule])

    print(f"vues : {Counter(r['view'] for r in rows).most_common()}\n")
    print(f"{'règle':<22}{'n':>6}{'déclenche':>11}{'dont majeur':>13}"
          f"{'p10':>9}{'médiane':>10}{'p90':>9}")
    print("-" * 80)
    order = sorted(by_rule, key=lambda k: -(1 - by_rule[k]["sev"]["none"] / max(1, by_rule[k]["n"])))
    for rule in order:
        e = by_rule[rule]
        fire = 1 - e["sev"]["none"] / e["n"]
        major = e["sev"]["major"] / e["n"]
        v = np.asarray(e["vals"]) if e["vals"] else np.asarray([np.nan])
        flag = "  ← à recalibrer" if fire > 0.25 else ""
        print(f"{rule:<22}{e['n']:>6}{fire:>10.0%}{major:>12.0%}"
              f"{np.percentile(v,10):>9.1f}{np.median(v):>10.1f}{np.percentile(v,90):>9.1f}{flag}")
    print("\nCible : aucune règle au-dessus de 25 % sur un corpus de bon niveau.")


def _fmt(metric: str, a: np.ndarray, tail_source: np.ndarray) -> str:
    """Le groupe donne la BANDE ; la largeur des queues vient du corpus entier.

    Sur 24 swings, l'écart entre 90e et 98e centile n'est estimé qu'à quelques
    unités près : s'en servir ferait sauter le diagnostic de « rien » à
    « important » en 1,6°.
    """
    scale = 100.0 if metric in PERCENT else 1.0
    nd = 3 if metric in PERCENT else (2 if metric == "setup_stance_width" else 1)
    q = lambda p: round(float(np.percentile(a, p)) / scale, nd)
    qt = lambda p: float(np.percentile(tail_source, p)) / scale
    tail = max(0.01, qt(98) - qt(90))
    d = DIRECTION[metric]
    if d == "up":
        return f"{{ ideal: {q(50)}, minor: {q(90)}, major: {round(q(90) + tail, nd)} }}"
    if d == "down":
        return (f"{{ idealMin: {q(10)}, minor: 0.5, major: {round(qt(10)-qt(2), 1)}, "
                f"windowStartSec: 0.07, windowEndSec: 0.2 }}")
    return (f"{{ idealMin: {q(10)}, idealMax: {q(90)}, "
            f"minor: {round(tail*0.3, nd)}, major: {round(tail, nd)} }}")


def cmd_suggest(rows: list[dict]) -> None:
    vals = collect(rows)
    print(f"{'règle':<22}{'sens':<7}{'n':>5}{'p2':>9}{'p10':>9}{'p50':>9}{'p90':>9}{'p98':>9}")
    print("-" * 79)
    for rule in sorted(vals):
        a = vals[rule]
        print(f"{rule:<22}{DIRECTION.get(rule,'up'):<7}{len(a):>5}"
              + "".join(f"{np.percentile(a,p):>9.2f}" for p in (2, 10, 50, 90, 98)))
    print("\n// seuils proposés (bloc FAULTS)")
    for rule in sorted(vals):
        print(f"  {TS_NAME[rule]}: {_fmt(rule, vals[rule], vals[rule])},")


def _group_values(rows: list[dict], labels_path: Path) -> dict[str, dict[str, list[float]]]:
    labels = {str(c["id"]): c for c in json.loads(labels_path.read_text())["clips"]}
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        clip = labels.get(str(r.get("id", "")))
        if not clip:
            continue
        group = CLUB_GROUP.get(clip.get("club", ""))
        if not group:
            continue
        for k, v in r["metrics"].items():
            by[k][group].append(v)
    return by


def _club_effect(groups: dict[str, np.ndarray]) -> float:
    """Écart des médianes rapporté à la dispersion interne des groupes."""
    medians = [float(np.median(a)) for a in groups.values()]
    spread = max(medians) - min(medians)
    iqr = float(np.median([np.percentile(a, 75) - np.percentile(a, 25) for a in groups.values()]))
    return spread / iqr if iqr > 1e-9 else 0.0


def cmd_clubs(rows: list[dict], labels_path: Path) -> None:
    by = _group_values(rows, labels_path)
    print(f"{'métrique':<20}{'groupe':<9}{'n':>5}{'p10':>9}{'médiane':>10}{'p90':>9}   effet")
    print("-" * 85)
    for metric in sorted(by):
        usable = {g: np.asarray(v) for g, v in by[metric].items() if len(v) >= MIN_GROUP_N}
        if len(usable) < 2:
            continue
        effect = _club_effect(usable)
        verdict = ("  ←← dépend du club" if effect > 0.5
                   else "  ← effet modéré" if effect > MIN_CLUB_EFFECT else "")
        first = True
        for g, a in sorted(usable.items(), key=lambda kv: -len(kv[1])):
            tail = f"   {effect:.2f}{verdict}" if first else ""
            print(f"{metric if first else '':<20}{g:<9}{len(a):>5}"
                  f"{np.percentile(a,10):>9.2f}{np.median(a):>10.2f}{np.percentile(a,90):>9.2f}{tail}")
            first = False
        print()


def cmd_club_config(rows: list[dict], labels_path: Path) -> None:
    by = _group_values(rows, labels_path)
    out = defaultdict(dict)
    decisions = []
    for metric, groups in by.items():
        usable = {g: np.asarray(v) for g, v in groups.items() if len(v) >= MIN_GROUP_N}
        if len(usable) < 2:
            continue
        effect = _club_effect(usable)
        if effect < MIN_CLUB_EFFECT:
            decisions.append(f"  {metric:<20} effet {effect:.2f} — bande commune conservée")
            continue
        decisions.append(f"  {metric:<20} effet {effect:.2f} — surcharge pour {', '.join(sorted(usable))}")
        pooled = np.concatenate(list(groups.values()))
        for g, a in usable.items():
            out[g][TS_NAME[metric]] = _fmt(metric, a, pooled)

    print("Décisions :")
    print("\n".join(sorted(decisions)))
    print("\n// bloc FAULTS_BY_CLUB")
    for g in ("driver", "wood", "iron"):
        if g not in out:
            continue
        print(f"  {g}: {{")
        for name, value in sorted(out[g].items()):
            print(f"    {name}: {value},")
        print("  },")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["firing", "suggest", "clubs", "club-config"])
    parser.add_argument("metrics", type=Path, help="sortie .jsonl de analyze.ts --batch")
    parser.add_argument("--labels", type=Path, help="labels.json, requis pour les commandes club")
    parser.add_argument("--no-filter", action="store_true",
                        help="ne pas filtrer sur la qualité (pour mesurer l'effet du filtrage)")
    args = parser.parse_args()

    rows = load(args.metrics, clean=not args.no_filter)
    if not rows:
        raise SystemExit("Aucun swing exploitable.")

    if args.command == "firing":
        cmd_firing(rows)
    elif args.command == "suggest":
        cmd_suggest(rows)
    else:
        if not args.labels:
            raise SystemExit(f"« {args.command} » requiert --labels.")
        (cmd_clubs if args.command == "clubs" else cmd_club_config)(rows, args.labels)


if __name__ == "__main__":
    main()
