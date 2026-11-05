"""Copy recent accepted LeetCode submissions to a GitHub repository."""

from __future__ import annotations

import argparse
import base64
import os
import re
import sys
from pathlib import Path

import requests


LEETCODE_API = "https://leetcode.com/graphql/"
GITHUB_API = "https://api.github.com"

USER_QUERY = "query { userStatus { isSignedIn username } }"
RECENT_QUERY = """
query RecentAccepted($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) {
    id
    titleSlug
    lang
  }
}
"""
DETAIL_QUERY = """
query SubmissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) { code }
}
"""

EXTENSIONS = {
    "bash": ".sh", "c": ".c", "cpp": ".cpp", "csharp": ".cs",
    "dart": ".dart", "elixir": ".ex", "erlang": ".erl", "golang": ".go",
    "java": ".java", "javascript": ".js", "kotlin": ".kt",
    "mysql": ".sql", "mssql": ".sql", "oraclesql": ".sql",
    "php": ".php", "postgresql": ".sql", "python": ".py",
    "python3": ".py", "racket": ".rkt", "ruby": ".rb",
    "rust": ".rs", "scala": ".scala", "swift": ".swift",
    "typescript": ".ts",
}


class SyncError(Exception):
    """An actionable sync failure."""


def load_env_file(path: Path) -> None:
    """Load the three credentials from a simple KEY=value .env file."""
    if not path.is_file():
        return
    allowed = {"LEETCODE_SESSION", "LEETCODE_CSRF_TOKEN", "GITHUB_TOKEN"}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or key not in allowed:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if not os.environ.get(key):
            os.environ[key] = value


def response_json(response: requests.Response, service: str) -> dict:
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise SyncError(f"{service} returned HTTP {response.status_code}.") from exc
    try:
        data = response.json()
    except ValueError as exc:
        raise SyncError(f"{service} returned a non-JSON response.") from exc
    if not isinstance(data, dict):
        raise SyncError(f"{service} returned an unexpected response.")
    return data


class LeetCode:
    def __init__(self, session_cookie: str, csrf_token: str):
        self.http = requests.Session()
        self.http.cookies.set("LEETCODE_SESSION", session_cookie, domain="leetcode.com")
        self.http.cookies.set("csrftoken", csrf_token, domain="leetcode.com")
        self.http.headers.update({
            "Content-Type": "application/json",
            "Referer": "https://leetcode.com/",
            "X-CSRFToken": csrf_token,
            "User-Agent": "leet2git/0.1",
        })

    def query(self, query: str, variables: dict | None = None) -> dict:
        response = self.http.post(
            LEETCODE_API, json={"query": query, "variables": variables or {}}, timeout=20
        )
        payload = response_json(response, "LeetCode")
        if payload.get("errors"):
            message = payload["errors"][0].get("message", "unknown GraphQL error")
            raise SyncError(f"LeetCode GraphQL error: {message}")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise SyncError("LeetCode returned no GraphQL data; check your session cookies.")
        return data

    def username(self) -> str:
        status = self.query(USER_QUERY).get("userStatus") or {}
        if not status.get("isSignedIn") or not status.get("username"):
            raise SyncError("LeetCode session is not signed in; refresh your browser cookies.")
        return status["username"]

    def recent_accepted(self, username: str, limit: int) -> list[dict]:
        submissions = self.query(
            RECENT_QUERY, {"username": username, "limit": limit}
        ).get("recentAcSubmissionList")
        if not isinstance(submissions, list):
            raise SyncError("LeetCode did not return a recent accepted submission list.")
        return submissions

    def code(self, submission_id: int) -> str:
        details = self.query(DETAIL_QUERY, {"submissionId": submission_id}).get(
            "submissionDetails"
        ) or {}
        code = details.get("code")
        if not isinstance(code, str) or not code.strip():
            raise SyncError(f"Submission {submission_id} has no accessible source code.")
        return code


class GitHub:
    def __init__(self, token: str):
        self.http = requests.Session()
        self.http.headers.update({
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "leet2git/0.1",
        })

    def owner(self) -> str:
        data = response_json(self.http.get(f"{GITHUB_API}/user", timeout=20), "GitHub")
        if not data.get("login"):
            raise SyncError("GitHub did not identify the token owner.")
        return data["login"]

    def ensure_repo(self, owner: str, name: str, public: bool) -> str:
        url = f"{GITHUB_API}/repos/{owner}/{name}"
        response = self.http.get(url, timeout=20)
        if response.status_code == 404:
            created = response_json(
                self.http.post(
                    f"{GITHUB_API}/user/repos",
                    json={"name": name, "private": not public},
                    timeout=20,
                ),
                "GitHub",
            )
            print(f"Created {created.get('html_url', f'https://github.com/{owner}/{name}')}")
        else:
            response_json(response, "GitHub")
        return f"{owner}/{name}"

    def upload_if_missing(self, repo: str, path: str, code: str) -> bool:
        url = f"{GITHUB_API}/repos/{repo}/contents/{path}"
        response = self.http.get(url, timeout=20)
        if response.status_code == 200:
            return False
        if response.status_code != 404:
            response_json(response, "GitHub")
        response_json(
            self.http.put(
                url,
                json={
                    "message": f"Add LeetCode submission {path.rsplit('/', 1)[-1]}",
                    "content": base64.b64encode(code.encode("utf-8")).decode("ascii"),
                },
                timeout=20,
            ),
            "GitHub",
        )
        return True


def submission_path(submission: dict) -> tuple[int, str]:
    raw_id = str(submission.get("id", ""))
    slug = submission.get("titleSlug")
    if not raw_id.isdecimal() or not isinstance(slug, str) or not re.fullmatch(
        r"[a-z0-9]+(?:-[a-z0-9]+)*", slug
    ):
        raise SyncError(f"Unexpected LeetCode submission metadata: {submission!r}")
    extension = EXTENSIONS.get(str(submission.get("lang", "")).lower(), ".txt")
    return int(raw_id), f"solutions/{slug}/{raw_id}{extension}"


def sync(leetcode: LeetCode, github: GitHub | None, repo_name: str,
         limit: int, public: bool, dry_run: bool) -> tuple[int, int]:
    username = leetcode.username()
    submissions = leetcode.recent_accepted(username, limit)
    if not submissions:
        print("No recent accepted submissions found.")
        return 0, 0

    # Download before creating a repository so a failed LeetCode call leaves no empty repo.
    files = []
    for submission in submissions:
        submission_id, path = submission_path(submission)
        files.append((path, leetcode.code(submission_id)))

    if dry_run:
        for path, _ in files:
            print(f"Would upload {path}")
        return len(files), 0

    assert github is not None
    owner = github.owner()
    repo = github.ensure_repo(owner, repo_name, public)
    uploaded = 0
    for path, code in reversed(files):
        if github.upload_if_missing(repo, path, code):
            print(f"Uploaded {path}")
            uploaded += 1
        else:
            print(f"Already present {path}")
    return len(files), uploaded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="leet2git", help="repository name under your GitHub account")
    parser.add_argument("--limit", type=int, default=20, help="recent accepted submissions (1-20)")
    parser.add_argument("--public", action="store_true", help="make a newly created repo public")
    parser.add_argument("--dry-run", action="store_true", help="fetch code without writing to GitHub")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", args.repo):
        parser.error("--repo must be a repository name, without an owner or slash")
    if not 1 <= args.limit <= 20:
        parser.error("--limit must be between 1 and 20")

    load_env_file(Path(__file__).with_name(".env"))
    required = ["LEETCODE_SESSION", "LEETCODE_CSRF_TOKEN"]
    if not args.dry_run:
        required.append("GITHUB_TOKEN")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        parser.error("missing environment variable(s): " + ", ".join(missing))

    try:
        leetcode = LeetCode(os.environ["LEETCODE_SESSION"], os.environ["LEETCODE_CSRF_TOKEN"])
        github = None if args.dry_run else GitHub(os.environ["GITHUB_TOKEN"])
        count, uploaded = sync(leetcode, github, args.repo, args.limit, args.public, args.dry_run)
        print(f"Checked {count} accepted submissions; uploaded {uploaded}.")
        return 0
    except (SyncError, requests.RequestException) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
