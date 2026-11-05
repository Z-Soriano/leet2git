const form = document.getElementById("settings");
const message = document.getElementById("message");
const save = document.getElementById("save");
const syncState = document.getElementById("sync-state");
let hasSavedConnection = false;
let savedEnabled = true;

function updateSyncState() {
  const state = form.enabled.checked !== savedEnabled ? "pending"
    : !hasSavedConnection ? "setup" : form.enabled.checked ? "on" : "off";
  syncState.dataset.state = state;
  syncState.textContent = { setup: "SETUP", on: "SYNC ON", off: "PAUSED", pending: "UNSAVED" }[state];
}

async function initialize() {
  const settings = await chrome.storage.local.get([
    "token", "owner", "repo", "enabled", "isPublic", "lastStatus", "destinationVersion",
  ]);
  const oldDefault = settings.repo === "leet2git" && settings.destinationVersion !== 2;
  form.repo.value = oldDefault ? "leetcode-solutions" : settings.repo || "leetcode-solutions";
  if (oldDefault) {
    message.textContent = "New destination: leetcode-solutions. Save and connect to create it now.";
  }
  form.enabled.checked = settings.enabled !== false;
  savedEnabled = form.enabled.checked;
  form.public.checked = Boolean(settings.isPublic);
  hasSavedConnection = Boolean(settings.token && settings.owner);
  updateSyncState();
  document.getElementById("token-hint").textContent = settings.token
    ? "Token saved. Leave this blank to keep it."
    : "A token with repo access can create the repository and upload files.";
  if (settings.lastStatus) {
    const date = new Date(settings.lastStatus.at);
    const time = document.getElementById("last-status-time");
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    document.getElementById("last-status").textContent = settings.lastStatus.message;
  }
}

form.enabled.addEventListener("change", updateSyncState);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "";
  message.textContent = "Connecting to GitHub…";
  save.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_CONFIG",
      repo: form.repo.value,
      token: form.token.value,
      enabled: form.enabled.checked,
      isPublic: form.public.checked,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not save settings.");
    form.token.value = "";
    message.className = "success";
    message.textContent = "Settings saved.";
    await initialize();
  } catch (error) {
    message.className = "error";
    message.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});

initialize().catch((error) => {
  message.className = "error";
  message.textContent = error.message;
});
