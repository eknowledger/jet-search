# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: on the repository page choose **Security**, then **Report a vulnerability**. You will get a reply within a few days.

## What Jet Search does with your data

- It reads the notes in your vault to build a search index.
- The index is stored in your browser storage (IndexedDB), outside the vault, on your device.
- It makes no network requests, with one exception: if you turn on search by meaning and confirm, it downloads the model files from Hugging Face at a pinned revision and checks them against pinned SHA-256 checksums.
- It sends no telemetry and needs no account.

## Supported versions

Only the latest release gets fixes.
