// Runs on LeetCode with its signed-in browser session. It never sees the GitHub token.
(() => {
  const DETAILS_QUERY = `query SubmissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      code statusCode lang { name } question { title titleSlug }
    }
  }`;
  const QUESTION_QUERY = `query QuestionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) { questionFrontendId title titleSlug }
  }`;
  const reporting = new Map();
  const finalizedIds = new Set();
  let pendingSubmitCount = 0;
  let badge;
  let badgeKind = "processing";
  let badgeMessage = "Checking leet2git connection…";
  let canProcess = null;
  let backendReady = false;
  let unavailableReason = "Connect GitHub in leet2git settings.";
  let submissionInProgress = false;
  let watcherReady = false;
  let watcherFailed = false;
  let probeCount = 0;
  let probeTimer;
  let timeout;

  function renderBadge() {
    if (!badge) return;
    badge.dataset.state = badgeKind;
    badge.title = `leet2git: ${badgeMessage}`;
    badge.setAttribute("aria-label", badge.title);
    badge.querySelector(".symbol").textContent = badgeKind === "error" ? "!" : "↗";
  }

  function showBadge(kind, message) {
    clearTimeout(timeout);
    badgeKind = kind;
    if (kind !== "processing" && pendingSubmitCount === 0 && reporting.size === 0) {
      submissionInProgress = false;
    }
    badgeMessage = String(message || "").slice(0, 180);
    if (kind === "processing") {
      timeout = setTimeout(() => {
        pendingSubmitCount = 0;
        reporting.clear();
        submissionInProgress = false;
        showBadge("error", "No submission result arrived. Refresh the LeetCode tab and try again.");
      }, 3 * 60 * 1000);
    }
    renderBadge();
  }

  function mountBadge() {
    if (!document.createElement) return;
    if (!document.documentElement) {
      document.addEventListener?.("DOMContentLoaded", mountBadge, { once: true });
      return;
    }
    const host = document.createElement("div");
    host.id = "leet2git-status-indicator";
    host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;width:36px;height:36px;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .badge { all: initial; display: grid; place-items: center; width: 36px; height: 36px;
        box-sizing: border-box; border-radius: 50%; background: #ffa116; color: #171717;
        box-shadow: 0 3px 14px #0008; font: 800 16px/1 ui-monospace, Consolas, monospace;
        cursor: default; }
      .badge:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
      .badge[data-state="error"] { background: #d83b3b; color: #fff; }
      .badge[data-state="processing"] { background: #171717; border: 2px solid #ffa116; }
      .badge[data-state="processing"] .symbol { display: none; }
      .spinner { display: none; width: 16px; height: 16px; box-sizing: border-box;
        border: 2px solid #6c4b1c; border-top-color: #ffa116; border-radius: 50%;
        animation: leet2git-spin .7s linear infinite; }
      .badge[data-state="processing"] .spinner { display: block; }
      @keyframes leet2git-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    `;
    badge = document.createElement("div");
    badge.className = "badge";
    badge.tabIndex = 0;
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-live", "polite");
    const symbol = document.createElement("span");
    symbol.className = "symbol";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    badge.append(symbol, spinner);
    shadow.append(style, badge);
    document.documentElement.append(host);
    renderBadge();
  }

  function refreshReadiness() {
    if (submissionInProgress) return;
    try {
      chrome.runtime.sendMessage({ type: "GET_READY" }, (response) => {
        const failure = chrome.runtime.lastError?.message ||
          (!response?.ok ? response?.error || "Could not reach leet2git." : "");
        if (failure) {
          canProcess = false;
          backendReady = false;
          unavailableReason = `Extension connection failed: ${failure}`;
          showBadge("error", unavailableReason);
          return;
        }
        canProcess = Boolean(response.canProcess);
        backendReady = Boolean(response.ready);
        unavailableReason = response.reason || "Sync is unavailable.";
        if (submissionInProgress && canProcess) return;
        if (response.ready && !watcherReady) {
          showBadge(watcherFailed ? "error" : "processing",
            watcherFailed ? "Submission watcher unavailable. Refresh this LeetCode tab."
              : "Starting submission watcher…");
          return;
        }
        showBadge(response.ready ? "ready" : "error", unavailableReason);
      });
    } catch (_) {
      canProcess = false;
      backendReady = false;
      unavailableReason = "Extension updated. Refresh this LeetCode tab.";
      showBadge("error", unavailableReason);
    }
  }

  mountBadge();
  if (typeof chrome.runtime.sendMessage === "function") refreshReadiness();
  window.addEventListener("focus", refreshReadiness);
  document.addEventListener?.("visibilitychange", () => {
    if (!document.hidden) refreshReadiness();
  });

  function probeWatcher() {
    if (watcherReady || typeof window.postMessage !== "function") return;
    if (probeCount >= 3) {
      watcherFailed = true;
      showBadge("error", "Submission watcher unavailable. Refresh this LeetCode tab.");
      return;
    }
    probeCount++;
    window.postMessage({ source: "leet2git-content", type: "PING" }, location.origin);
    if (!watcherReady) probeTimer = setTimeout(probeWatcher, 600);
  }

  function finalizeSubmit(id) {
    if (finalizedIds.has(id)) return;
    finalizedIds.add(id);
    if (finalizedIds.size > 200) finalizedIds.delete(finalizedIds.values().next().value);
    if (pendingSubmitCount > 0) pendingSubmitCount--;
  }

  function showReadyWhenIdle(message) {
    if (pendingSubmitCount > 0 || reporting.size > 0) {
      showBadge("processing", "Checking another submission…");
    } else {
      showBadge("ready", message);
    }
  }

  function csrfToken() {
    const pair = document.cookie.split("; ").find((part) => part.startsWith("csrftoken="));
    return pair ? decodeURIComponent(pair.slice("csrftoken=".length)) : "";
  }

  async function graphql(query, variables) {
    const headers = { "Content-Type": "application/json" };
    const csrf = csrfToken();
    if (csrf) headers["X-CSRFToken"] = csrf;
    const response = await fetch("https://leetcode.com/graphql/", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`LeetCode returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(`LeetCode GraphQL: ${payload.errors[0].message}`);
    if (!payload.data) throw new Error("LeetCode returned no submission data");
    return payload.data;
  }

  async function detailsFor(id) {
    let details;
    for (let attempt = 0; attempt < 4; attempt++) {
      details = (await graphql(DETAILS_QUERY, { submissionId: Number(id) })).submissionDetails;
      if (Number(details?.statusCode) === 10 &&
          typeof details.code === "string" && details.code.trim()) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (Number(details?.statusCode) !== 10) return { accepted: false };
    if (!details?.code?.trim()) throw new Error(`Submission ${id} has no source code yet`);
    const slug = details.question?.titleSlug;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || "")) {
      throw new Error(`Submission ${id} has no valid problem slug`);
    }
    const question = (await graphql(QUESTION_QUERY, { titleSlug: slug })).question;
    if (!question?.questionFrontendId || !question?.title) {
      throw new Error(`Could not find the question number and name for ${slug}`);
    }
    return {
      accepted: true,
      id: String(id),
      code: details.code,
      lang: details.lang?.name || "unknown",
      slug,
      number: String(question.questionFrontendId),
      title: question.title,
    };
  }

  function reportCandidate(id, confirmed = false) {
    const existing = reporting.get(id);
    if (existing) {
      existing.confirmed = existing.confirmed || confirmed;
      return;
    }
    const state = { confirmed };
    reporting.set(id, state);
    submissionInProgress = true;
    showBadge("processing", "Checking submission and saving it to GitHub…");

    function send(attempt) {
      try {
        chrome.runtime.sendMessage({ type: "ACCEPTED_CANDIDATE", id }, (response) => {
          const failure = chrome.runtime.lastError?.message || response?.error ||
            (!response?.ok ? "Could not check this submission." : "");
          if (failure) {
            if (attempt < 2) {
              setTimeout(() => send(attempt + 1), 1500 * (attempt + 1));
            } else {
              reporting.delete(id);
              backendReady = false;
              unavailableReason = failure;
              showBadge("error", failure);
            }
            return;
          }
          if (response.outcome === "not-accepted" && state.confirmed) {
            if (attempt < 2) {
              setTimeout(() => send(attempt + 1), 1500 * (attempt + 1));
              return;
            }
            reporting.delete(id);
            backendReady = false;
            unavailableReason = "LeetCode showed Accepted, but its submission details could not be confirmed.";
            showBadge("error", unavailableReason);
            return;
          }
          reporting.delete(id);
          if (response.outcome === "not-accepted" && !backendReady) {
            showBadge("error", unavailableReason);
            refreshReadiness();
          } else {
            backendReady = true;
            showReadyWhenIdle(response.message || "Submission checked. Ready for the next one.");
          }
        });
      } catch (_) {
        reporting.delete(id);
        backendReady = false;
        unavailableReason = "Extension updated. Refresh this LeetCode tab.";
        showBadge("error", "Extension updated. Refresh this LeetCode tab.");
      }
    }

    send(0);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== "leet2git-page") return;
    if (message.type === "LISTENER_READY") {
      watcherReady = true;
      watcherFailed = false;
      clearTimeout(probeTimer);
      if (!submissionInProgress) refreshReadiness();
      return;
    }
    if (message.type === "SUBMIT_STARTED") {
      if (canProcess !== false) pendingSubmitCount++;
      submissionInProgress = canProcess !== false;
      showBadge(canProcess === false ? "error" : "processing",
        canProcess === false ? unavailableReason : "Waiting for LeetCode to judge the submission…");
      return;
    }
    if (message.type === "SUBMIT_FAILED") {
      if (pendingSubmitCount > 0) pendingSubmitCount--;
      const status = Number.isInteger(message.status) && message.status > 0 ? ` (HTTP ${message.status})` : "";
      showBadge("error", `LeetCode could not start the submission${status}.`);
      return;
    }
    if (!/^\d+$/.test(String(message.id || ""))) return;
    if (message.type === "CHECK_FAILED") {
      if (badgeKind === "processing") showBadge("error", "Could not check the LeetCode result.");
      return;
    }
    if (message.type === "SUBMISSION_RESULT") {
      finalizeSubmit(String(message.id));
      const ready = canProcess === true && backendReady;
      if (ready) showReadyWhenIdle("Submission checked. It was not Accepted, so nothing was saved.");
      else showBadge("error", unavailableReason);
      if (!ready) refreshReadiness();
      return;
    }
    if (message.type === "SUBMISSION") {
      finalizeSubmit(String(message.id));
      if (canProcess === false) {
        showBadge("error", unavailableReason);
        return;
      }
      reportCandidate(String(message.id), Boolean(message.confirmed));
    }
  });

  probeWatcher();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_SUBMISSION" || !/^\d+$/.test(String(message.id || ""))) return;
    detailsFor(message.id)
      .then((details) => sendResponse({ ok: true, details }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
