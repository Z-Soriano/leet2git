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

  function reportCandidate(id, attempt = 0) {
    chrome.runtime.sendMessage({ type: "ACCEPTED_CANDIDATE", id }, (response) => {
      if ((chrome.runtime.lastError || response?.ok === false) && attempt < 2) {
        setTimeout(() => reportCandidate(id, attempt + 1), 1500 * (attempt + 1));
      }
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== "leet2git-page" || message.type !== "SUBMISSION") return;
    if (!/^\d+$/.test(String(message.id || ""))) return;
    reportCandidate(String(message.id));
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_SUBMISSION" || !/^\d+$/.test(String(message.id || ""))) return;
    detailsFor(message.id)
      .then((details) => sendResponse({ ok: true, details }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
