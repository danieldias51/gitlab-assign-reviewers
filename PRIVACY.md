# Privacy Policy for GitLab Assign Reviewers

Last updated: 10 November 2026

GitLab Assign Reviewers is a Firefox extension that adds teammates as reviewers on GitLab merge requests. This policy explains what data the extension handles and where it goes.

## Summary

- The extension sends data only to the GitLab site you configure in its settings.
- The developer does not operate a server, does not receive your data, and does not use analytics or tracking.
- Nothing is sent to third parties.

## Data stored in your browser

The extension saves these settings with `browser.storage.local`, which stays on your computer and in your Firefox profile:

- The GitLab site address you entered.
- Reviewer group names and the GitLab usernames in each group.
- The group you chose as the default, and the authentication mode you selected.
- If you chose a personal access token: the token. It is stored in plain text in the extension's local storage. Anyone with access to your Firefox profile can read it.

## Data sent to your GitLab site

When you click **Add team reviewers**, the extension talks only to the GitLab site you configured:

1. It reads the merge request to see who is already a reviewer.
2. It posts a comment containing `/assign_reviewer` with the usernames that are not yet reviewers.
3. It reads the merge request again to confirm the result.

Depending on the authentication mode you chose:

- **Browser session:** the request uses your existing GitLab login in that tab. The extension reads the page's CSRF token to authorise the request. It does not read or store your session cookie.
- **Personal access token:** the token is sent in a `PRIVATE-TOKEN` header to the GitLab site you configured.

The usernames you enter are sent to that same GitLab site, because GitLab needs them to add reviewers.

## Permissions the extension requests

- **Storage:** to save your settings locally.
- **Scripting and active tab:** to read the merge request page and send the request from the open tab.
- **Access to a GitLab site:** requested only for the site you enter in settings, when you save them. Firefox asks you to grant it.

## What the extension does not do

- It does not collect analytics, crash reports, or usage statistics.
- It does not send data to the developer or to any other service.
- It does not read or change pages on sites other than the GitLab site you configured.

## Your choices

- You can change or remove the saved settings, including the token, from the extension's settings page.
- You can remove the extension at any time from `about:addons`, which deletes its local storage.
- You can revoke a personal access token at any time in your GitLab settings.

## Contact

Questions about this policy can be raised as an issue at https://github.com/danieldias51/gitlab-assign-reviewers/issues
