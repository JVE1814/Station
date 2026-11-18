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


def constrain_grade(
    chainages: list[float],
    heights: list[float],
    maximum_grade: float,
) -> list[float]:
    steps = [end - start for start, end in pairwise(chainages)]
    weights = [steps[0], *((a + b) / 2 for a, b in pairwise(steps)), steps[-1]]
    offsets = [maximum_grade * (distance - chainages[0]) for distance in chainages]
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
        raise ValueError("The rail gradient fit did not converge")
    return profile
