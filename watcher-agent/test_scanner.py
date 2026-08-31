import json
import os
import tempfile
import unittest
import urllib.error
from unittest import mock

import scanner


def touch(path, content=b"x" * 10):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)


class FindVideoFilesTests(unittest.TestCase):
    def test_finds_a_movie_under_an_allowlisted_category(self):
        with tempfile.TemporaryDirectory() as root:
            touch(os.path.join(root, "bollywood", "2021", "Haseen Dillruba (2021)", "movie.mp4"))
            found = list(scanner.find_video_files(root))
            self.assertEqual(found, ["bollywood/2021/Haseen Dillruba (2021)/movie.mp4"])

    def test_ignores_every_real_operational_directory_seen_on_production(self):
        # These exact names are real siblings of the content categories on both
        # production FTP roots — none of them should ever be walked.
        junk_dirs = [
            "torrent", "ffmpeg", "ffmpeg-encoded", "downloads", "games", "software",
            "Subtitles", "lancache", "watch2", "watch3", "watch4", ".hls", ".sync",
            "Emby Backup - 2022-12-12 00.10.0 - Auto", "ftp", "FTP",
        ]
        with tempfile.TemporaryDirectory() as root:
            for d in junk_dirs:
                touch(os.path.join(root, d, "some-video.mp4"))
            touch(os.path.join(root, "hollywood", "2026", "Real Film (2026)", "real.mp4"))

            found = list(scanner.find_video_files(root))
            self.assertEqual(found, ["hollywood/2026/Real Film (2026)/real.mp4"])

    def test_matches_the_category_case_insensitively(self):
        with tempfile.TemporaryDirectory() as root:
            touch(os.path.join(root, "Bollywood", "2021", "Film (2021)", "f.mp4"))
            found = list(scanner.find_video_files(root))
            self.assertEqual(len(found), 1)

    def test_ignores_non_video_files_inside_a_content_category(self):
        with tempfile.TemporaryDirectory() as root:
            touch(os.path.join(root, "bollywood", "2021", "Film (2021)", "poster.jpg"))
            touch(os.path.join(root, "bollywood", "2021", "Film (2021)", "subs.srt"))
            found = list(scanner.find_video_files(root))
            self.assertEqual(found, [])

    def test_accepts_every_common_video_container(self):
        with tempfile.TemporaryDirectory() as root:
            for i, ext in enumerate(["mp4", "mkv", "avi", "m4v", "mov", "ts", "webm"]):
                touch(os.path.join(root, "hollywood", f"Film {i} (2026)", f"f.{ext}"))
            found = list(scanner.find_video_files(root))
            self.assertEqual(len(found), 7)

    def test_returns_forward_slash_paths(self):
        with tempfile.TemporaryDirectory() as root:
            touch(os.path.join(root, "tamil", "2021", "Film (2021)", "f.mp4"))
            found = list(scanner.find_video_files(root))
            self.assertNotIn("\\", found[0])
            self.assertEqual(found[0], "tamil/2021/Film (2021)/f.mp4")


class ScanOnceStabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.state_file = os.path.join(self.root, "state.json")
        self.movie_path = os.path.join(self.root, "hollywood", "2026", "Film (2026)", "film.mp4")

    def tearDown(self):
        self.tmp.cleanup()

    def scan(self, report_mock):
        with mock.patch.object(scanner, "report", report_mock):
            scanner.scan_once(self.root, self.state_file, "http://jarvis.local", "key123", log=lambda *_: None)

    def read_state(self):
        with open(self.state_file) as f:
            return json.load(f)

    def test_does_not_report_on_first_sighting(self):
        touch(self.movie_path)
        report_mock = mock.Mock()
        self.scan(report_mock)
        report_mock.assert_not_called()

        state = self.read_state()
        self.assertEqual(state["hollywood/2026/Film (2026)/film.mp4"]["status"], "watching")

    def test_reports_once_size_is_unchanged_across_two_scans(self):
        touch(self.movie_path)
        self.scan(mock.Mock())  # first sighting

        report_mock = mock.Mock(return_value=True)
        self.scan(report_mock)  # same size as before -> stable

        report_mock.assert_called_once_with(
            "http://jarvis.local", "key123", "hollywood/2026/Film (2026)/film.mp4"
        )
        state = self.read_state()
        self.assertEqual(state["hollywood/2026/Film (2026)/film.mp4"]["status"], "done")

    def test_does_not_report_a_file_still_growing(self):
        touch(self.movie_path, content=b"a" * 10)
        self.scan(mock.Mock())

        touch(self.movie_path, content=b"a" * 20)  # grew between scans
        report_mock = mock.Mock()
        self.scan(report_mock)

        report_mock.assert_not_called()
        state = self.read_state()
        self.assertEqual(state["hollywood/2026/Film (2026)/film.mp4"]["status"], "watching")
        self.assertEqual(state["hollywood/2026/Film (2026)/film.mp4"]["size"], 20)

    def test_never_reports_an_already_done_file_again(self):
        touch(self.movie_path)
        self.scan(mock.Mock())
        self.scan(mock.Mock(return_value=True))

        report_mock = mock.Mock()
        self.scan(report_mock)  # third scan, file unchanged and already done
        report_mock.assert_not_called()

    def test_retries_on_the_next_scan_when_report_fails(self):
        touch(self.movie_path)
        self.scan(mock.Mock())  # first sighting
        self.scan(mock.Mock(return_value=False))  # stable, but Jarvis/network failed

        state = self.read_state()
        self.assertEqual(state["hollywood/2026/Film (2026)/film.mp4"]["status"], "watching")

        report_mock = mock.Mock(return_value=True)
        self.scan(report_mock)  # still stable -> retried immediately
        report_mock.assert_called_once()

    def test_state_persists_to_disk_between_process_runs(self):
        touch(self.movie_path)
        self.scan(mock.Mock())
        self.assertTrue(os.path.exists(self.state_file))

        # A brand-new call (as a fresh process would make) still sees the prior scan's state.
        report_mock = mock.Mock(return_value=True)
        self.scan(report_mock)
        report_mock.assert_called_once()


class ReportTests(unittest.TestCase):
    def test_true_on_a_2xx_response(self):
        response = mock.MagicMock()
        response.status = 201
        response.__enter__.return_value = response
        with mock.patch("urllib.request.urlopen", return_value=response):
            self.assertTrue(scanner.report("http://jarvis.local", "key", "a/b.mp4"))

    def test_sends_bearer_auth_and_the_source_path(self):
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["auth"] = req.get_header("Authorization")
            captured["body"] = json.loads(req.data)
            response = mock.MagicMock()
            response.status = 200
            response.__enter__.return_value = response
            return response

        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            scanner.report("http://jarvis.local", "key123", "bollywood/2021/Film (2021)/f.mp4")

        self.assertEqual(captured["url"], "http://jarvis.local/api/watcher/ingest")
        self.assertEqual(captured["auth"], "Bearer key123")
        self.assertEqual(captured["body"], {"sourcePath": "bollywood/2021/Film (2021)/f.mp4"})

    def test_true_on_a_400_since_a_malformed_path_will_never_succeed_on_retry(self):
        error = urllib.error.HTTPError("url", 400, "bad", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error):
            self.assertTrue(scanner.report("http://jarvis.local", "key", "a/b.mp4"))

    def test_false_on_a_502_so_it_is_retried(self):
        error = urllib.error.HTTPError("url", 502, "bad gateway", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error):
            self.assertFalse(scanner.report("http://jarvis.local", "key", "a/b.mp4"))

    def test_false_on_a_network_error(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("no route")):
            self.assertFalse(scanner.report("http://jarvis.local", "key", "a/b.mp4"))


if __name__ == "__main__":
    unittest.main()
