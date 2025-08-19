# env-guardian

🔍 A simple CLI tool to scan your project for **environment variable usage** and **secret-like candidates**.  
Helps you keep sensitive values out of source code and organized into a `.env` file.

---

## Features

- Detects existing `process.env.*` usage in `.ts`, `.js`, `.tsx`, and `.jsx` files  
- Suggests likely environment variables from hardcoded values (keys, secrets, tokens, passwords, URLs, etc.)  
- Highlights results:
  - ✅ Existing variables in **green**
  - ⚠ Suggested candidates in **yellow**
- Optional `.env` integration:
  - Appends suggested keys to `.env` with a `# Suggested by env-guardian` marker

---

## Installation

```bash
npm install -g env-guardian
