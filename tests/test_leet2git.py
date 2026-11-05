import base64
import os
import unittest
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch

from leet2git import GitHub, LeetCode, SyncError, load_env_file, submission_path, sync


def response(status, data=None):
    result = Mock()
    result.status_code = status
    result.json.return_value = data or {}
    if status >= 400:
        result.raise_for_status.side_effect = Exception("HTTP error")
    return result


class SyncTests(unittest.TestCase):
    def test_loads_dotenv_values_without_overriding_shell(self):
        content = (
            "LEETCODE_SESSION=abc=123\nLEETCODE_CSRF_TOKEN='csrf-value'\n"
            "GITHUB_TOKEN=from-file\n"
        )
        with patch.object(Path, "is_file", return_value=True), patch.object(
            Path, "read_text", return_value=content
        ):
            with patch.dict(os.environ, {"GITHUB_TOKEN": "from-shell"}, clear=True):
                load_env_file(Path("example.env"))
                self.assertEqual(os.environ["LEETCODE_SESSION"], "abc=123")
                self.assertEqual(os.environ["LEETCODE_CSRF_TOKEN"], "csrf-value")
                self.assertEqual(os.environ["GITHUB_TOKEN"], "from-shell")

    def test_submission_path_uses_id_and_safe_slug(self):
        self.assertEqual(
            submission_path({"id": "123", "titleSlug": "two-sum", "lang": "python3"}),
            (123, "solutions/two-sum/123.py"),
        )
        with self.assertRaises(SyncError):
            submission_path({"id": "123", "titleSlug": "../bad", "lang": "python3"})

    def test_sync_creates_repo_and_skips_existing_file(self):
        leetcode = Mock(spec=LeetCode)
        leetcode.username.return_value = "solver"
        leetcode.recent_accepted.return_value = [
            {"id": "2", "titleSlug": "add-two-numbers", "lang": "cpp"},
            {"id": "1", "titleSlug": "two-sum", "lang": "python3"},
        ]
        leetcode.code.side_effect = ["int main() {}", "print(1)"]
        github = Mock(spec=GitHub)
        github.owner.return_value = "owner"
        github.ensure_repo.return_value = "owner/leet2git"
        github.upload_if_missing.side_effect = [False, True]

        self.assertEqual(sync(leetcode, github, "leet2git", 20, False, False), (2, 1))
        github.ensure_repo.assert_called_once_with("owner", "leet2git", False)
        self.assertEqual(github.upload_if_missing.call_args_list[0].args,
                         ("owner/leet2git", "solutions/two-sum/1.py", "print(1)"))

    def test_github_create_and_base64_upload(self):
        github = GitHub("test-token")
        github.http = Mock()
        github.http.get.side_effect = [response(404), response(404)]
        github.http.post.return_value = response(201, {"html_url": "https://github.com/owner/leet2git"})
        github.http.put.return_value = response(201, {"content": {"path": "solutions/two-sum/1.py"}})

        self.assertEqual(github.ensure_repo("owner", "leet2git", False), "owner/leet2git")
        self.assertTrue(github.upload_if_missing("owner/leet2git", "solutions/two-sum/1.py", "print(1)"))
        self.assertEqual(github.http.post.call_args.kwargs["json"],
                         {"name": "leet2git", "private": True})
        encoded = github.http.put.call_args.kwargs["json"]["content"]
        self.assertEqual(base64.b64decode(encoded), b"print(1)")


if __name__ == "__main__":
    unittest.main()
