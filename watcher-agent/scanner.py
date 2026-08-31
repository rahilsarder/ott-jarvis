#!/usr/bin/env python3
"""
Jarvis FTP watcher agent.

Runs on each media box (one per FTP root — cdn, cdn2), scans a fixed set of
content-category directories on the *local* filesystem, and reports new,
size-stable video files to Jarvis's POST /api/watcher/ingest endpoint.
Jarvis does all path classification, title/year parsing, and TMDB
enrichment centrally; this agent's only job is: find files, wait for them
to stop growing, report each one exactly once.

Configuration (environment variables):
  JARVIS_URL         Base URL of the Jarvis instance, e.g. http://jarvis.internal:3100
  JARVIS_API_KEY     A Jarvis API key (see the Jarvis /content page's API keys panel)
  MEDIA_ROOT         Root directory to scan, e.g. /media/data
  STATE_FILE         Where to persist per-file scan state
                      (default: <MEDIA_ROOT>/.jarvis-watcher-state.json)
  SCAN_INTERVAL_SEC  How often to rescan, in seconds (default: 300)

Usage:
  python3 scanner.py --once   # single scan, for cron
  python3 scanner.py          # long-lived loop, for systemd

Zero third-party dependencies by design — this needs to run on production
media boxes with nothing beyond a stock Python 3 interpreter.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Mirrors jarvis: src/lib/ingest.ts MOVIE_CATEGORIES exactly. Jarvis
# independently re-validates every reported path against its own allowlist,
# so drift here only wastes a scan cycle rather than mis-ingesting anything —
# but it should still be kept in sync.
MOVIE_CATEGORIES = {
    "animated",
    "bangladeshi movie",
    "bollywood",
    "dhallywood",
    "foreign",
    "hollywood",
    "indian bangla",
    "pakistani",
    "tamil",
}

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".m4v", ".mov", ".ts", ".webm"}

STATUS_WATCHING = "watching"
STATUS_DONE = "done"


def is_video(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in VIDEO_EXTENSIONS


def find_video_files(media_root):
    """Yields relative, forward-slash paths of every video file under an
    allowlisted top-level category directory.

    Both production roots keep real content categories alongside
    operational directories in the very same tree (torrent, ffmpeg,
    ffmpeg-encoded, downloads, games, software, Subtitles, lancache,
    watch2/3/4, .hls, .sync, Emby backups, and literal ftp/FTP staging
    dirs). This is an allowlist, not a blocklist, so none of those are ever
    walked at all, and a new junk directory appearing later is ignored by
    default rather than scanned.
    """
    for category in sorted(os.listdir(media_root)):
        if category.lower() not in MOVIE_CATEGORIES:
            continue
        category_path = os.path.join(media_root, category)
        if not os.path.isdir(category_path):
            continue
        for dirpath, _dirnames, filenames in os.walk(category_path):
            for filename in filenames:
                if not is_video(filename):
                    continue
                full_path = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(full_path, media_root)
                yield rel_path.replace(os.sep, "/")


def load_state(state_file):
    if not os.path.exists(state_file):
        return {}
    with open(state_file, "r") as f:
        return json.load(f)


def save_state(state_file, state):
    # Write-then-rename so a crash mid-write never leaves a truncated,
    # unreadable state file behind.
    tmp_path = state_file + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(state, f)
    os.replace(tmp_path, state_file)


def report(jarvis_url, api_key, source_path, timeout=15):
    """POSTs one path to Jarvis. Returns True once Jarvis has durably
    recorded it — created, already-seen, or explicitly out of scope — any
    of which means this agent should stop tracking it. Returns False only
    on a transient failure (network error, TMDB hiccup, Jarvis down), which
    leaves the file in "watching" state so the next scan retries on its own.
    """
    body = json.dumps({"sourcePath": source_path}).encode("utf-8")
    req = urllib.request.Request(
        f"{jarvis_url.rstrip('/')}/api/watcher/ingest",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        # A 400 (malformed/unsafe path) will never succeed on retry; anything
        # else (502 from a transient TMDB failure, etc.) plausibly will.
        return e.code == 400
    except urllib.error.URLError:
        return False


def scan_once(media_root, state_file, jarvis_url, api_key, log=print):
    """Runs one full scan. Reports each newly-stable file exactly once,
    across however many calls this ends up being — a file is only skipped
    on a later scan once Jarvis has actually accepted it."""
    state = load_state(state_file)

    for rel_path in find_video_files(media_root):
        try:
            size = os.path.getsize(os.path.join(media_root, rel_path))
        except OSError as e:
            log(f"skip (stat failed): {rel_path}: {e}")
            continue

        entry = state.get(rel_path)
        if entry is not None and entry.get("status") == STATUS_DONE:
            continue

        if entry is None or entry.get("size") != size:
            # First sighting, or still growing — record the size and wait
            # for a later scan to confirm it has stopped changing before
            # ever reporting it.
            state[rel_path] = {"size": size, "status": STATUS_WATCHING}
            continue

        # Same size as the last scan: stable, safe to report.
        if report(jarvis_url, api_key, rel_path):
            state[rel_path] = {"size": size, "status": STATUS_DONE}
            log(f"reported: {rel_path}")
        else:
            log(f"report failed, will retry next scan: {rel_path}")

    save_state(state_file, state)


def main():
    media_root = os.environ["MEDIA_ROOT"]
    jarvis_url = os.environ["JARVIS_URL"]
    api_key = os.environ["JARVIS_API_KEY"]
    state_file = os.environ.get("STATE_FILE", os.path.join(media_root, ".jarvis-watcher-state.json"))
    interval = int(os.environ.get("SCAN_INTERVAL_SEC", "300"))

    once = "--once" in sys.argv

    while True:
        scan_once(media_root, state_file, jarvis_url, api_key)
        if once:
            break
        time.sleep(interval)


if __name__ == "__main__":
    main()
