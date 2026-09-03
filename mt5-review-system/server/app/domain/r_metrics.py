from __future__ import annotations

import math
from statistics import mean, stdev
from typing import Any

from .campaigns import VOLUME_EPSILON, calculate_campaign_r


def _calculate_r_runs_z(
    campaigns: list[dict[str, Any]], scratch_threshold_r: float
) -> dict[str, Any]:
    ordered = sorted(
        campaigns,
        key=lambda campaign: (
            str(campaign.get("closed_at_utc") or ""),
            str(campaign.get("id") or ""),
        ),
    )
    outcomes = []
    for campaign in ordered:
        value = campaign.get("campaign_r")
        if value is None:
            continue
        numeric = float(value)
        if abs(numeric) <= scratch_threshold_r:
            continue
        outcomes.append(1 if numeric > 0 else -1)
    n = len(outcomes)
    wins = sum(outcome > 0 for outcome in outcomes)
    losses = n - wins
    runs = sum(
        outcomes[index] != outcomes[index - 1] for index in range(1, n)
    ) + (1 if n else 0)
    result: dict[str, Any] = {
        "n": n,
        "wins": wins,
        "losses": losses,
        "runs": runs,
        "z": None,
        "classification": "insufficient_data",
    }
    if n < 2 or not wins or not losses:
        return result
    x = 2 * wins * losses
    denominator = math.sqrt(x * (x - n) / (n - 1)) if x > n else 0.0
    if denominator <= 0:
        return result
    z = (n * (runs - 0.5) - x) / denominator
    result["z"] = round(z, 4)
    if z > 1.96:
        result["classification"] = "alternating"
    elif z < -1.96:
        result["classification"] = "clustered"
    else:
        result["classification"] = "independent"
    return result


def build_r_metrics(
    campaigns: list[dict[str, Any]], scratch_threshold_r: float = 0.15
) -> dict[str, Any]:
    threshold = float(scratch_threshold_r)
    complete = [
        campaign
        for campaign in campaigns
        if campaign.get("campaign_r") is not None
        and math.isfinite(float(campaign["campaign_r"]))
    ]
    values = [float(campaign["campaign_r"]) for campaign in complete]
    wins = [value for value in values if value > threshold]
    losses = [value for value in values if value < -threshold]
    scratches = [value for value in values if abs(value) <= threshold]
    decisive_count = len(wins) + len(losses)

    sqn = None
    if len(values) < 30:
        sqn_status = "insufficient_sample"
    elif stdev(values) <= VOLUME_EPSILON:
        sqn_status = "zero_variance"
    else:
        sqn_status = "available"
        sqn = round(mean(values) / stdev(values) * math.sqrt(len(values)), 4)

    total_count = len(campaigns)
    complete_count = len(complete)
    return {
        "sample_count": total_count,
        "complete_count": complete_count,
        "missing_count": total_count - complete_count,
        "coverage_rate": complete_count / total_count if total_count else 0.0,
        "scratch_threshold_r": threshold,
        "scratch_count": len(scratches),
        "scratch_rate": len(scratches) / complete_count if complete_count else 0.0,
        "win_count": len(wins),
        "loss_count": len(losses),
        "decisive_win_rate": len(wins) / decisive_count if decisive_count else 0.0,
        "all_sample_win_rate": len(wins) / complete_count if complete_count else 0.0,
        "expectancy_r": sum(values) / complete_count if complete_count else None,
        "sqn": sqn,
        "sqn_status": sqn_status,
        "sqn_minimum_sample": 30,
        "z_score": _calculate_r_runs_z(complete, threshold),
    }
