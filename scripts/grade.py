"""Fit an elevation profile subject to a bound on climbing and descending grades."""

from itertools import pairwise


def isotonic(values: list[float], weights: list[float]) -> list[float]:
    """Weighted projection onto nondecreasing sequences."""
    blocks = []
    for value, weight in zip(values, weights, strict=True):
        blocks.append((value, weight, 1))
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            right, right_weight, right_count = blocks.pop()
            left, left_weight, left_count = blocks.pop()
            combined = left_weight + right_weight
            mean = (right * right_weight + left * left_weight) / combined
            blocks.append((mean, combined, left_count + right_count))
    return [level for level, _, count in blocks for _ in range(count)]


def fit_long_alignment(heights, weights, offsets):
    import numpy as np
    from scipy.optimize import isotonic_regression

    profile = np.asarray(heights, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    offsets = np.asarray(offsets, dtype=np.float64)
    correction = [np.zeros_like(profile), np.zeros_like(profile)]
    for _ in range(256):
        previous = profile
        for index, direction in enumerate((1, -1)):
            target = profile + correction[index]
            fitted = isotonic_regression(direction * target + offsets, weights=weights).x
            profile = direction * (fitted - offsets)
            correction[index] = target - profile
        if np.max(np.abs(previous - profile)) < 1e-7:
            break
    return profile.tolist()


def constrain_grade(
    chainages: list[float],
    heights: list[float],
    maximum_grade: float,
) -> list[float]:
    steps = [end - start for start, end in pairwise(chainages)]
    weights = [steps[0], *((a + b) / 2 for a, b in pairwise(steps)), steps[-1]]
    offsets = [maximum_grade * (distance - chainages[0]) for distance in chainages]
    if len(heights) >= 10000:
        profile = fit_long_alignment(heights, weights, offsets)
    else:
        correction = [[0.0] * len(heights), [0.0] * len(heights)]
        profile = heights.copy()
        for _ in range(256):
            previous = profile
            for index, direction in enumerate((1, -1)):
                target = [value + error for value, error in zip(profile, correction[index], strict=True)]
                shifted = [direction * value + offset for value, offset in zip(target, offsets, strict=True)]
                fitted = isotonic(shifted, weights)
                profile = [direction * (value - offset) for value, offset in zip(fitted, offsets, strict=True)]
                correction[index] = [x - y for x, y in zip(target, profile, strict=True)]
            if max(abs(a - b) for a, b in zip(previous, profile, strict=True)) < 1e-7:
                break

    if any(abs(b - a) > step * maximum_grade + 1e-5
           for (a, b), step in zip(pairwise(profile), steps, strict=True)):
        # The numerical projection may retain a residual on a very long route.
        # Intersect upward and downward grade envelopes in two linear passes.
        lower = profile.copy()
        upper = profile.copy()
        for index, length in enumerate(steps, 1):
            change = length * maximum_grade
            lower[index] = min(lower[index], lower[index - 1] + change)
            upper[index] = max(upper[index], upper[index - 1] - change)
        for index in range(len(steps) - 1, -1, -1):
            change = steps[index] * maximum_grade
            lower[index] = min(lower[index], lower[index + 1] + change)
            upper[index] = max(upper[index], upper[index + 1] - change)
        profile = [(lo + hi) * 0.5 for lo, hi in zip(lower, upper, strict=True)]
    return profile
