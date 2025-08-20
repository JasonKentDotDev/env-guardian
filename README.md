# @jkdd/env-guardian

🔍 A simple CLI tool to scan your project for **environment variable usage** and **secret-like candidates**.  
Helps you keep sensitive values out of source code and organized into a `.env` file.

---

## Features

- Detects existing `process.env.*` usage in `.ts`, `.js`, `.tsx`, and `.jsx` files  
- Suggests likely environment variables from hardcoded values (keys, secrets, tokens, passwords, URLs, etc.)  
- Highlights results:
  - ✅ Existing variables in **green**
  - ⚠ Suggested candidates in **yellow**
- Optional `.env` integration with `--to-env` option:
  - Appends suggested keys to `.env` with a `# Suggested by env-guardian` marker

---

## Installation

```bash
npm install -g @jkdd/env-guardian
```

---

## Usage
# Scan

```bash
# Run scan
env-guardian scan ./src

# Results
Environment Variable Report:

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
secret (found in: File.tsx)
apiKey (found in: config.js)
```

# Options

```bash
# Run scan with option to create or append suggestions to a .env file
env-guardian scan ./src --to-env

# Results
Environment Variable Report:

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
secret (found in: File.tsx)
apiKey (found in: config.js)

✨ Added 2 suggestion(s) to .env
```
If you run the command again, it will not duplicate additions
```bash
# Results
Environment Variable Report:

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
secret (found in: File.tsx)
apiKey (found in: config.js)

No new suggestions to add to .env
```
