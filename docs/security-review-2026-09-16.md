# Data-access review — 2026-09-16

## Results

- Live signed-out Firestore REST list/query requests for six top-level collections and four collection groups returned HTTP 403 with no documents. The task API and reminder endpoint returned HTTP 401 without credentials.
- The deployed Firestore rules matched `firestore.rules` exactly at review time. No unconditional public read rule was present.
- Firebase Rules API simulation passed all 46 cases using synthetic records: signed-out, outside-company, unverified-company, ordinary assignee, bootstrap administrator, and delegated administrator access. Other assignees’ tasks and server-only notification receipts were denied. Client writes to task documents were denied.
- Approved company users intentionally retain access to all Progress Board and Appeals on Hold records. Ordinary task users may read only their own tasks; task administrators may read all tasks and the member directory.
- The local browser required login for all five routes, including requests containing `admin=true`, `auth=true`, or another assignee’s email. Synthetic legacy board caches were cleared before login. No browser errors were reported.

## Exposure found and deployed fixes

Before this fix, the live public JavaScript bundle contained 38 distinct names from the hardcoded initial board. Authentication gates do not protect static JavaScript downloads. The released source now starts with an empty board instead of embedded client records; the rebuilt JavaScript contains none of those names.

The Progress Board also previously retained records, archives, and activity in localStorage. The updated code disables board persistence when Firebase is configured and removes legacy caches at startup and sign-out. This does not delete Firestore records. Offline development and fictional demo data retain browser persistence.

Four cache regression tests were added. After the shared-auth refactor finished, all 31 project tests, full-repository lint, and the production build passed.

## Release status and limits

The fixes were deployed and promoted to production as `dpl_nj7SC4npjWxy98a9LHEj9E4n92Q5` on 2026-09-16, including the completed shared-auth changes. The live JavaScript was checked on `dashboard.veteranschoiceglobal.com`, `vcg-home-dashboard.vercel.app`, and the redirected `vcg-progress-board.vercel.app`: no matches for the 38 seed names remain.

An isolated browser seeded all six legacy storage keys with synthetic data on both public origins. Reloading the live app cleared all six, preserved unrelated storage, and required login even with `?admin=true`. Browser errors and post-release runtime error logs were empty. The daily reminder schedule remains active.

All 50 listed historical deployment homepages redirected anonymous visitors, and the project retains its existing deployment protection. The 18 project aliases were also checked: two served the current public app, one redirected to it, and the remaining aliases were protected or unavailable. The retired JavaScript path no longer serves JavaScript on the public domains (HTML fallback or the existing domain redirect); the same path redirects to Vercel authentication on the previous production deployment and the oldest listed deployment. A bulk asset-path sweep encountered intermittent connection timeouts, so asset-level verification was limited to these five endpoints. No deployment was deleted and no protection was disabled.

Browser-cache cleanup runs when a browser loads the updated app. Users should reload open tabs. A release cannot retract copies downloaded before the fix.

The Rules API checks simulate authorization and are not live logins as other users. This review is not a guarantee against every possible exposure and does not cover historical Git history, third-party email inboxes, or cloud administrator IAM permissions. No test created, edited, or deleted production business records or sent mail.

Rules test reference: [Firebase Rules test API](https://firebase.google.com/docs/reference/rules/rest/v1/projects/test).
