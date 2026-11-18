import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from source_data import download, elevation_tiles


class SourceDataTest(unittest.TestCase):
    def test_download_rejects_truncated_response_and_keeps_previous_file(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            current = cache / "current"
            current.write_bytes(b"previous")

            def transfer(command, *, check):
                self.assertTrue(check)
                Path(command[command.index("--output") + 1]).write_bytes(b"short")

            with patch("source_data.CACHE", cache), patch("source_data.subprocess.run", transfer):
                with self.assertRaisesRegex(ValueError, "Wrong size"):
                    download("https://example.com/data", "current", expected_size=10)
            self.assertEqual(current.read_bytes(), b"previous")

    def test_elevation_bounds_cross_degree_boundaries(self):
        with patch("source_data.elevation_tile", side_effect=lambda lat, lon: (lat, lon)):
            self.assertEqual(elevation_tiles(59.9, 10.9, 60.1, 11.1),
                             [(59, 10), (59, 11), (60, 10), (60, 11)])


if __name__ == "__main__":
    unittest.main()
