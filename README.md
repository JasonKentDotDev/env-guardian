# @jkdd/env-guardian

🔍 A simple CLI tool to scan your project for **environment variable usage** and **secret-like candidates**.  
Helps you keep sensitive values out of source code and organized into a `.env` file.

---

## Features

- Simple CLI, no config required!
- Detects existing Environment Variable usage in the following file types:
  - JavaScript (.js & .jsx)
  - TypeScript (.ts & .tsx)
  - Vue.js (.vue)
  - Python (.py)
  - Ruby (.rb)
  - Shell Script (.sh)
  - Bash (.bash)
  - JSON (.json)
  - Yaml (.yaml & .yml)
  - PHP (.php)
  - Java (.java)
  - Kotlin (.kt)
  - Go (.go)
  - C# (.cs)
  - Dockerfile
  - NPM config files (npmrc, yarnrc)
  - CI/CD (github, gitlab, circleci, azure)
- Suggests likely environment variables from hardcoded values (keys, secrets, tokens, passwords, URLs, etc.)  
- Highlights results:
  - ✅ Existing variables in **green** 🟢
  - ⚠ Suggested candidates in **yellow** 🟡
- Priority is categorized by color as well:
  - [CRITICAL] is in **red** 🔴
  - [HIGH] is in **orange** 🟠
  - [MEDIUM] is in **yellow** 🟡
  - [LOW] is in **green** 🟢
- Optional `.env` integration with `--to-env` option:
  - Appends suggested keys to `.env` with a `# Suggested by env-guardian` marker
  - Option may have user defined filename added as well, `--to-env .env.local`
  - Any file creation or manipulation will happen in the project's root folder
- Ignore false positives
  - Ignore variables or files permanently via `.envscanignore.json`
  - Reset ignores back to default

---

## Installation

```bash
npm install @jkdd/env-guardian
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
------------Environment Variable Report------------

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
[MEDIUM] secret (found in: File.tsx)
[HIGH] apiKey (found in: config.js)
```

### Options
#### To Env

```bash
# Run scan with option to create or append suggestions to a .env file
env-guardian scan ./src --to-env                # defaults to .env in root folder
# or
env-guardian scan ./src --to-env .env.local     # uses user defined filename in root folder

# Results
------------Environment Variable Report------------

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
------------Environment Variable Report------------

Existing Environment Variables:
✔ VAR_NAME (used in: Home.tsx)

⚠ Suggested Environment Variables:
[MEDIUM] secret (found in: File.tsx)
[HIGH] apiKey (found in: config.js)

No new suggestions to add to .env # or ex: .env.local
```

**Important note:** Environment variables and secrets go into very specific 
files depending on what language or framework you are using. For a full list 
of compatible file types and naming conventions, please read the documentation 
found [here](https://env-guardian.online/docs/env-naming-conventions/env-files).

#### Ignore false positives

```bash
# Run ignore command
env-guardian ignore variableName

# You may ignore multiple variables at a time if desired
env-guardian ignore variableName variableName2

# You can also ignore entire files, insert as many as you wish at a time
env-guardian ignore-files path/to/file.js
```

These commands will add the desired variables/files to an ignore list (`.envscanignore.json`) found in the root directory.

```bash
# .envscanignore.json
{
  "ignore": {
    "variables": [
      "variableName", 
      "variableName2"
    ],
    "files": [
      "path/to/file.js"
    ]
  }
}
```

#### Set priority level for `scan`

```bash
# Run set-priority command
env-guardian set-priority high

# Results
✔ Priority set to [HIGH]
```

You may reset `scan` results by running the `reset-priority` command.

```bash
env-guardian reset-priority

# Results
🔄 Priority filter reset. All severities will be shown on scan.
```
