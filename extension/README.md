# leet2git browser extension

This Chromium extension watches LeetCode problem pages. It acts only after you make a **new Submit request** and that submission is **Accepted**. It reads that submission from LeetCode and saves it to GitHub. Opening an old problem or old submission page does not start an upload. The extension runs while you solve problems; you do not need to leave an extension tab or popup open.

## Install

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge. In Opera GX, press **Ctrl+Shift+E**.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `extension` folder.
4. Click the leet2git toolbar icon once to configure it. Enter a GitHub personal access token and a repository name, then click **Save and connect**. The default repository name is `leetcode-solutions`, separate from the `leet2git` project repository. If it does not exist, the extension creates it as a private repository. The **Make a new repository public** box changes only a newly created repository. Existing installs using the old `leet2git` default switch to `leetcode-solutions` automatically on their next Accepted submission.
5. Reload any LeetCode problem tab that was already open. Stay signed in to `leetcode.com` and submit normally. You can close the popup immediately after setup.

For the easiest first setup, a GitHub classic personal access token with the `repo` scope works for private repository creation and file uploads. If you already have the repository, a fine-grained token with **Contents: Read and write** access to that repository can be used. Creating a missing repository with a fine-grained token needs additional repository creation or Administration write permission. The extension asks for the GitHub token in its popup; it does **not** read the Python script's `.env` file. It uses your browser's existing LeetCode login, so you do not enter a LeetCode cookie.

## What it saves

Each Accepted submission creates `solutions/<problem-slug>/<submission-id>.<extension>`. The question folder also gets a `README.md` with the displayed question number and name. Existing files are skipped. For example:

```text
solutions/
  two-sum/
    README.md
    123456789.py
    123456790.cpp
```

On LeetCode problem pages, a small circle appears at the bottom right. **Orange** means the extension is ready, a **spinning ring** means a new submission is being judged or saved, and **red** means it cannot check or save submissions. Hover over or focus the circle to read the current status. A non-Accepted result returns to orange without uploading. The popup still shows the latest upload or error, but it does not need to stay open. A green check on the toolbar icon means the last upload succeeded; `!` means something needs attention. The extension runs only when you use a LeetCode problem page in this browser. It does not import old submissions automatically. The Python command in the parent folder remains available if you deliberately want to import recent accepted submissions that the extension missed.

## Limits

LeetCode's submission API and page behavior are undocumented. If a LeetCode update changes them, the extension may need an update. This extension has been checked with mocked LeetCode and GitHub responses; a real Accepted submission must be used to confirm it in your browser and account.
