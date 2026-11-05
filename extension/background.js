// Event-driven GitHub uploader. The GitHub token stays in trusted extension contexts.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const defaultRepo = "leetcode-solutions";
const destinationVersion = 2;
const pending = new Set();
let migrationPromise;
const languageExtensions = {
  "bash": "sh", "c": "c", "c++": "cpp", "cpp": "cpp", "c#": "cs", "csharp": "cs",
  "dart": "dart", "elixir": "ex", "erlang": "erl", "go": "go", "golang": "go",
  "java": "java", "javascript": "js", "kotlin": "kt", "mysql": "sql",
  "mssql": "sql", "oraclesql": "sql", "php": "php", "postgresql": "sql",
  "python": "py", "python3": "py", "racket": "rkt", "ruby": "rb",
  "rust": "rs", "scala": "scala", "swift": "swift", "typescript": "ts",
};

function fileExtension(language) {
  return languageExtensions[String(language || "").toLowerCase().replace(/\s+/g, "")] || "txt";
}

function githubPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function githubRequest(token, path, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function requireGithub(response) {
  if (response.ok) return response;
  let message = "";
  try { message = (await response.json()).message || ""; } catch (_) { /* Keep status only. */ }
  throw new Error(`GitHub HTTP ${response.status}${message ? `: ${message}` : ""}`);
}

async function ensureRepo(token, owner, name, isPublic) {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const existing = await githubRequest(token, path);
  if (existing.ok) return `https://github.com/${owner}/${name}`;
  if (existing.status !== 404) await requireGithub(existing);
  const created = await githubRequest(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, private: !isPublic }),
  });
  await requireGithub(created);
  return (await created.json()).html_url || `https://github.com/${owner}/${name}`;
}

async function putIfMissing(token, owner, repo, path, content) {
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${githubPath(path)}`;
  const existing = await githubRequest(token, url);
  if (existing.ok) return false;
  if (existing.status !== 404) await requireGithub(existing);
  const uploaded = await githubRequest(token, url, {
    method: "PUT",
    body: JSON.stringify({
      message: `Add LeetCode ${path.split("/").at(-1)}`,
      content: base64Utf8(content),
    }),
  });
  await requireGithub(uploaded);
  return true;
}

async function setStatus(kind, message) {
  await chrome.storage.local.set({ lastStatus: { kind, message, at: Date.now() } });
  await chrome.action.setBadgeText({ text: kind === "error" ? "!" : kind === "uploaded" ? "✓" : "" });
  if (kind !== "idle") {
    await chrome.action.setBadgeBackgroundColor({ color: kind === "error" ? "#b42318" : "#137333" });
  }
}

async function saveConfig(message) {
  await storageReady;
  const repo = String(message.repo || "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Enter a repository name without a slash.");
  const previous = await chrome.storage.local.get("token");
  const token = String(message.token || "").trim() || previous.token;
  if (!token) throw new Error("Enter a GitHub personal access token.");

  const userResponse = await githubRequest(token, "/user");
  await requireGithub(userResponse);
  const owner = (await userResponse.json()).login;
  if (!owner) throw new Error("GitHub did not return a username.");
  const repoUrl = await ensureRepo(token, owner, repo, Boolean(message.isPublic));

  await chrome.storage.local.set({
    token, owner, repo, repoUrl, enabled: Boolean(message.enabled),
    isPublic: Boolean(message.isPublic), destinationVersion,
  });
  await setStatus("idle", `Connected to ${owner}/${repo}`);
  return { owner, repo, repoUrl };
}

async function migrateOldDefault(settings) {
  if (settings.destinationVersion === destinationVersion || settings.repo !== "leet2git") {
    return settings;
  }
  // Existing installs saved the old default. Share the migration across
  // submissions detected at the same time, and never upload to the old repo.
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const repoUrl = await ensureRepo(
        settings.token, settings.owner, defaultRepo, Boolean(settings.isPublic),
      );
      await chrome.storage.local.set({ repo: defaultRepo, repoUrl, destinationVersion });
      return { repo: defaultRepo, repoUrl, destinationVersion };
    })().finally(() => { migrationPromise = undefined; });
  }
  return { ...settings, ...await migrationPromise };
}

async function syncSubmission(id, tabId) {
  await storageReady;
  let settings = await chrome.storage.local.get([
    "token", "owner", "repo", "enabled", "isPublic", "destinationVersion",
  ]);
  if (!settings.enabled || !settings.token || !settings.owner || !settings.repo) return;

  const result = await chrome.tabs.sendMessage(tabId, { type: "GET_SUBMISSION", id });
  if (!result?.ok) throw new Error(result?.error || "Could not read the LeetCode submission.");
  const details = result.details;
  const number = typeof details?.number === "string"
    ? details.number.replace(/[\r\n]/g, " ").trim() : "";
  if (!details?.accepted) return;
  if (details.id !== id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(details.slug || "") ||
      typeof details.code !== "string" || !details.code.trim() ||
      !number || number.length > 50 ||
      typeof details.title !== "string" || details.title.length > 200) {
    throw new Error("LeetCode returned incomplete submission details.");
  }

  settings = await migrateOldDefault(settings);
  const folder = `solutions/${details.slug}`;
  const codePath = `${folder}/${id}.${fileExtension(details.lang)}`;
  const codeUploaded = await putIfMissing(
    settings.token, settings.owner, settings.repo, codePath, details.code,
  );
  const safeTitle = details.title.replace(/[\r\n]/g, " ");
  const readme = `# ${number}. ${safeTitle}\n\n` +
    `Problem: https://leetcode.com/problems/${details.slug}/\n\n` +
    `Solutions are named by LeetCode submission ID.\n`;
  await putIfMissing(settings.token, settings.owner, settings.repo, `${folder}/README.md`, readme);
  await setStatus(
    codeUploaded ? "uploaded" : "idle",
    `${codeUploaded ? "Uploaded" : "Already saved"} ${number}. ${safeTitle} (${id})`,
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SAVE_CONFIG") {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    saveConfig(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "ACCEPTED_CANDIDATE") {
    let url;
    try { url = new URL(sender.url); } catch (_) { return; }
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
        url.origin !== "https://leetcode.com" || !url.pathname.startsWith("/problems/") ||
        !/^\d+$/.test(String(message.id || ""))) return;
    const id = String(message.id);
    if (pending.has(id)) { sendResponse({ ok: true, duplicate: true }); return; }
    pending.add(id);
    syncSubmission(id, sender.tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        await setStatus("error", error.message);
        sendResponse({ ok: false, error: error.message });
      })
      .finally(() => pending.delete(id));
    return true;
  }
});
