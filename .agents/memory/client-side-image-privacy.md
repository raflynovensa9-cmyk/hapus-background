---
name: Client-side image privacy
description: The image background remover processes user images locally in the browser.
---

Keep background-removal processing in the browser; do not add image upload or server storage unless the user explicitly requests remote processing.

**Why:** This avoids sending user image files to the server and limits how the app handles private images.

**How to apply:** Preserve local processing and local PNG downloads. If changing that architecture, explain the privacy tradeoff and confirm first.
