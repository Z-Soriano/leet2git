# leet2git

A small Python command that copies your 20 most recent **Accepted** LeetCode submissions to GitHub. It saves each submission as `solutions/<problem-slug>/<submission-id>.<language-extension>`. Running it again skips files already present. If the target repository does not exist, it creates it under the GitHub account for your token. New repositories are private by default.

## Setup

1. Install Python 3.10 or newer and run `python -m pip install -r requirements.txt`.
2. While signed in to [leetcode.com](https://leetcode.com), open your browser's developer tools, find the cookies for `leetcode.com`, and copy the values of `LEETCODE_SESSION` and `csrftoken` (not the whole `name=value` strings).
3. Create a GitHub personal access token. A classic token with the `repo` scope can create a private repository and write files. For an existing repository, a fine-grained token with Contents write permission works; creating a repository also needs Administration write permission. Keep these credentials out of Git.
4. Create a `.env` file beside `leet2git.py` with this format (replace the placeholders with the cookie **values** and token):

   ```dotenv
   LEETCODE_SESSION=your_leetcode_session_value
   LEETCODE_CSRF_TOKEN=your_csrftoken_value
   GITHUB_TOKEN=your_github_personal_access_token
   ```

   Do not include `Cookie:`, `name=`, or extra spaces inside a value. The script loads this file automatically. Values already set in your shell take precedence.

5. In PowerShell, run:

   ```powershell
   python leet2git.py --dry-run
   python leet2git.py
   ```

The default repository name is `leet2git`. Use `--repo my-solutions` for a different name, `--limit 5` for fewer submissions, or `--public` to make a **new** repository public. The existing local Git `origin` is unrelated to this setting; the command uses the GitHub API directly.

## Notes

- This imports only the recent accepted window returned by LeetCode (up to 20), not your entire history. Run it regularly to catch new submissions. It does not run on a schedule by itself.
- LeetCode's GraphQL API is undocumented and can change or block automated requests. If you get a sign-in or HTTP 403 error, refresh your LeetCode cookies and run locally again.
- `--dry-run` needs only the LeetCode variables. It fetches source code but makes no GitHub changes.
- Never commit tokens or cookies. `.env` is ignored by Git; keep it on your own computer.
