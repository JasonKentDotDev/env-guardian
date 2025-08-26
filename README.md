# @jkdd/env-guardian

🔍 A simple CLI tool to scan your project for **environment variable usage** and **secret-like candidates**.  
Helps you keep sensitive values out of source code and organized into a `.env` file.

---

## Features

- Detects existing Environment Variable usage in the following file types:
  - JavaScript (.js & .jsx)
  - TypeScript (.ts & .tsx)
  - Vue.js (.vue)
  - Python (.py)
  - Ruby (.rb)
  - Shell Script (.sh)
  - Bash (.bash)
  - ENV (.env)
  - JSON (.json)
  - Yaml (.yaml & .yml)
  - PHP (.php)
  - Java (.java)
  - Kotlin (.kt)
  - Go (.go)
  - C# (.cs)
- Suggests likely environment variables from hardcoded values (keys, secrets, tokens, passwords, URLs, etc.)  
- Highlights results:
  - ✅ Existing variables in **green**
  - ⚠ Suggested candidates in **yellow**
- Priority is categorized by color as well:
  - [CRITICAL] is in **red**
  - [HIGH] is in **orange**
  - [MEDIUM] is in **yellow**
  - [LOW] is in **green**
- Optional `.env` integration with `--to-env` option:
  - Appends suggested keys to `.env` with a `# Suggested by env-guardian` marker
  - Option may have user defined filename added as well, `--to-env .env.local`
  - Any file creation or manipulation will happen in the project's root folder

---

## Installation

```bash
npm install -g @jkdd/env-guardian
```

---

## Usage
### Scan

```bash
# Run scan
env-guardian scan           # defaults to scan the current directory
env-guardian scan ./src     # for a specific folder
                            # 'env-guardian scan .' scans current dir

# Results
Environment Variable Report:

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
[MEDIUM] secret (found in: File.tsx)
[HIGH] apiKey (found in: config.js)
```

### Options

```bash
# Run scan with option to create or append suggestions to a .env file
env-guardian scan ./src --to-env # defaults to .env in root folder
# or
env-guardian scan ./src --to-env .env.local # uses user defined filename in root folder

# Results
Environment Variable Report:

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
[MEDIUM] secret (found in: File.tsx)
[HIGH] apiKey (found in: config.js)

✨ Added 2 suggestion(s) to .env # or ex: .env.local
```

If you run the command again, it will not duplicate additions

```bash
# Results
Environment Variable Report:

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
[MEDIUM] secret (found in: File.tsx)
[HIGH] apiKey (found in: config.js)

No new suggestions to add to .env # or ex: .env.local
```
