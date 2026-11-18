from itertools import pairwise
import unittest

from grade import constrain_grade


class GradeFitTest(unittest.TestCase):
    def test_rejects_surface_artifacts_without_moving_an_already_safe_profile(self):
        alignment = [0, 10, 25, 30, 50, 100]
        safe = [50, 50.1, 50.4, 50.5, 50.5, 51]
        fitted = constrain_grade(alignment, safe, 0.027)
        for a, b in zip(safe, fitted, strict=True):
            self.assertAlmostEqual(a, b)

        cliff = [50, 49, 52, 49.2, 70, 51]
        bounded = constrain_grade(alignment, cliff, 0.027)
        for (a, b), (start, end) in zip(pairwise(bounded), pairwise(alignment), strict=True):
            self.assertLessEqual(abs(b - a), (end - start) * 0.027 + 1e-5)
