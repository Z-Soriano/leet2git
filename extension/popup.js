const form = document.getElementById("settings");
const message = document.getElementById("message");
const save = document.getElementById("save");

async function initialize() {
  const settings = await chrome.storage.local.get([
    "token", "repo", "enabled", "isPublic", "lastStatus", "destinationVersion",
  ]);
  const oldDefault = settings.repo === "leet2git" && settings.destinationVersion !== 2;
  form.repo.value = oldDefault ? "leetcode-solutions" : settings.repo || "leetcode-solutions";
  if (oldDefault) {
    message.textContent = "New destination: leetcode-solutions. Save and connect to create it now.";
  }
  form.enabled.checked = settings.enabled !== false;
  form.public.checked = Boolean(settings.isPublic);
  document.getElementById("token-hint").textContent = settings.token
    ? "Token saved. Leave this blank to keep it."
    : "A token with repo access can create the repository and upload files.";
  if (settings.lastStatus) {
    const date = new Date(settings.lastStatus.at).toLocaleString();
    document.getElementById("last-status").textContent =
      `Last result (${date}): ${settings.lastStatus.message}`;
  }
}

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
    message.textContent = `Connected to ${response.data.owner}/${response.data.repo}.`;
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
