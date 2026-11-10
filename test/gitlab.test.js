"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GitLabReviewers: api } = require("../src/gitlab.js");

test("normalizeOrigin accepts a host and a full origin", () => {
  assert.equal(api.normalizeOrigin("gitlab.example.com").value, "https://gitlab.example.com");
  assert.equal(api.normalizeOrigin("https://gitlab.com/").value, "https://gitlab.com");
  assert.equal(
    api.normalizeOrigin("http://gitlab.internal:8080").value,
    "http://gitlab.internal:8080"
  );
});

test("normalizeOrigin rejects paths, queries, and credentials", () => {
  assert.match(api.normalizeOrigin("https://gitlab.com/group").error, /site root/);
  assert.match(api.normalizeOrigin("https://user:pass@gitlab.com").error, /password/);
  assert.match(api.normalizeOrigin("").error, /GitLab site/);
  assert.match(api.normalizeOrigin("ftp://gitlab.com").error, /https/);
});

test("parseUsernames splits commas, whitespace, and @ signs", () => {
  assert.deepEqual(
    api.parseUsernames(" @Alice, bob\ncarol; @bob "),
    ["Alice", "bob", "carol"]
  );
  assert.deepEqual(api.parseUsernames(""), []);
});

test("parseSettingsInput keeps a token only when that mode needs one", () => {
  const session = api.parseSettingsInput({
    gitlabOrigin: "https://gitlab.example.com",
    groups: [{ id: "team", name: "Team", usernames: ["alice", "bob"] }],
    activeGroupId: "team",
    authMode: "session",
    accessToken: "test-token"
  });
  assert.equal(session.value.authMode, "session");
  assert.equal(session.value.accessToken, "test-token");

  const missingToken = api.parseSettingsInput({
    gitlabOrigin: "https://gitlab.example.com",
    groups: [{ id: "team", name: "Team", usernames: ["alice"] }],
    authMode: "token",
    accessToken: "  "
  });
  assert.match(missingToken.error, /access token/);
});

test("settingsFromStorage turns a saved username list into the default group", () => {
  const settings = api.settingsFromStorage({
    gitlabOrigin: "https://gitlab.example.com",
    usernames: ["alice", "bob"],
    authMode: "session"
  });
  assert.equal(settings.groups.length, 1);
  assert.equal(settings.groups[0].name, "Team");
  assert.deepEqual(settings.groups[0].usernames, ["alice", "bob"]);
  assert.equal(api.activeGroup(settings).name, "Team");
});

test("settingsFromStorage keeps named groups and falls back when the default is missing", () => {
  const settings = api.settingsFromStorage({
    groups: [
      { id: "back", name: "Backend", usernames: ["alice"] },
      { id: "front", name: "Frontend", usernames: ["bob"] }
    ],
    activeGroupId: "missing",
    usernames: ["old"]
  });
  assert.deepEqual(settings.groups.map((group) => group.name), ["Backend", "Frontend"]);
  assert.equal(settings.activeGroupId, "back");
  assert.equal(api.activeGroup(settings).name, "Backend");
});

test("parseSettingsInput accepts several groups and keeps the chosen default", () => {
  const parsed = api.parseSettingsInput({
    gitlabOrigin: "https://gitlab.example.com",
    activeGroupId: "front",
    authMode: "session",
    groups: [
      { id: "back", name: " Backend ", usernames: ["alice"] },
      { id: "front", name: "Frontend", usernames: ["bob", "bob"] }
    ]
  });
  assert.equal(parsed.value.activeGroupId, "front");
  assert.equal(parsed.value.groups[0].name, "Backend");
  assert.deepEqual(parsed.value.groups[1].usernames, ["bob"]);
  assert.equal(api.activeGroup(parsed.value).name, "Frontend");
  assert.equal(api.groupById(parsed.value, "back").name, "Backend");
});

test("parseSettingsInput rejects duplicate group names and empty groups", () => {
  const duplicate = api.parseSettingsInput({
    gitlabOrigin: "https://gitlab.example.com",
    groups: [
      { id: "a", name: "Backend", usernames: ["alice"] },
      { id: "b", name: "backend", usernames: ["bob"] }
    ]
  });
  assert.match(duplicate.error, /two groups/i);

  const empty = api.parseSettingsInput({
    gitlabOrigin: "https://gitlab.example.com",
    groups: [{ id: "a", name: "Frontend", usernames: [] }]
  });
  assert.match(empty.error, /Frontend/);
});

test("parseMergeRequestUrl reads nested groups and ignores other pages", () => {
  assert.deepEqual(
    api.parseMergeRequestUrl("https://gitlab.example.com/group/sub/app/-/merge_requests/42/diffs?view=parallel"),
    {
      origin: "https://gitlab.example.com",
      projectPath: "group/sub/app",
      iid: "42"
    }
  );
  assert.equal(
    api.parseMergeRequestUrl("https://gitlab.example.com/group/app/-/merge_requests/new"),
    null
  );
  assert.equal(api.parseMergeRequestUrl("https://example.com/not-gitlab"), null);
});

test("missing reviewers are compared without case differences", () => {
  assert.deepEqual(api.missing(["Alice", "bob", "carol"], ["alice", "dave"]), ["bob", "carol"]);
  assert.deepEqual(api.overlap(["Alice", "bob"], ["alice"]), ["Alice"]);
});

test("reviewer helpers build the quick action and the API path", () => {
  assert.equal(api.assignCommand(["alice", "bob"]), "/assign_reviewer @alice @bob");
  assert.equal(
    api.mergeRequestPath("group/sub/app", "42"),
    "/api/v4/projects/group%2Fsub%2Fapp/merge_requests/42"
  );
  assert.deepEqual(
    api.reviewerUsernames({ reviewers: [{ username: "alice" }, { username: "" }, null] }),
    ["alice"]
  );
});

test("summarize distinguishes added, existing, and failed usernames", () => {
  assert.equal(
    api.summarize({ added: [], already: ["alice"], failed: [] }),
    "Everyone on your list is already a reviewer."
  );
  assert.match(
    api.summarize({ added: ["bob"], already: ["alice"], failed: ["carol"] }),
    /Added @bob.*Already reviewing: @alice.*Could not add @carol/
  );
  assert.equal(api.outcomeStatus({ added: ["bob"], failed: ["carol"] }), "warning");
  assert.equal(api.outcomeStatus({ added: [], failed: [] }), "success");
});

test("error messages point at the selected authentication mode", () => {
  assert.match(api.errorMessage(401, "", "token"), /access token/);
  assert.match(api.errorMessage(401, "", "session"), /browser session/);
  assert.match(api.errorMessage(404, "{\"message\":\"404 Project Not Found\"}", "token"), /could not find/);
});
