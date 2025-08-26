import fs from 'fs';
import path from 'path';

export interface EnvScanResultEntry {
  usage: string[];
  suggested: {
    file: string;
    value?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }[];
}

export type EnvScanResult = Record<string, EnvScanResultEntry>;

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

function stripComments(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments
}

function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

// Language-specific candidate matchers
const MATCHERS: Record<string, RegExp[]> = {
  // JS/TS (+ variants mapped)
  js: [/(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?=;|\n|$)/g],
  ts: [/(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?:;|\n|$)/g],
  jsx: [/(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?:;|\n|$)/g],
  tsx: [/(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?:;|\n|$)/g],

  // Vue single file components
  vue: [/(data\s*\(\)\s*{[\s\S]*?return\s*{[\s\S]*?})/g, /(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?:;|\n|$)/g],

  // Python
  py: [/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"`]?.+['"`]?)/g],

  // Ruby
  rb: [/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)/g],

  // Shell scripts
  sh: [/export\s+([A-Z0-9_]+)=([^\n]+)/g, /([A-Z0-9_]+)=([^\n]+)/g],
  bash: [/export\s+([A-Z0-9_]+)=([^\n]+)/g, /([A-Z0-9_]+)=([^\n]+)/g],

  // ENV files
  env: [/([A-Z0-9_]+)=([^\n]+)/g],

  // JSON / package.json
  json: [/["']([A-Z0-9_]+)["']\s*:\s*["']?(.+?)["']?/g],

  // YAML
  yml: [/([A-Z0-9_]+):\s*(.+)/gi],
  yaml: [/([A-Z0-9_]+):\s*(.+)/gi],

  // PHP
  php: [/\$([A-Za-z0-9_]+)\s*=\s*(.+);/g],

  // Java / Kotlin / Go / C#
  java: [/String\s+([A-Za-z0-9_]+)\s*=\s*(.+);/g],
  kt: [/val\s+([A-Za-z0-9_]+)\s*=\s*(.+)/g],
  go: [/([A-Za-z0-9_]+)\s*:=\s*(.+)/g],
  cs: [/var\s+([A-Za-z0-9_]+)\s*=\s*(.+);/g],

  // Dockerfile
  dockerfile: [/ENV\s+([A-Z0-9_]+)\s+(.+)/gi, /ARG\s+([A-Z0-9_]+)=([^\n]+)/gi],

  // NPM config files
  npmrc: [/\/\/.*:_authToken=(.+)/gi, /_auth\s*=\s*(.+)/gi],
  yarnrc: [/npmAuthToken:\s*(.+)/gi, /_authToken\s*=\s*(.+)/gi],

  // CI/CD
  github: [/([A-Z0-9_]+):\s*(.+)/gi],
  gitlab: [/([A-Z0-9_]+):\s*(.+)/gi],
  circleci: [/([A-Z0-9_]+):\s*(.+)/gi],
  azure: [/([A-Z0-9_]+):\s*(.+)/gi],
};


function looksSensitiveName(name: string): boolean {
  const sensitive = [
    'secret',
    'token',
    'key',
    'password',
    'passwd',
    'pwd',
    'apikey',
    'api',
    'auth',
    'jwt',
    'bearer',
    'client',
    'issuer',
    'webhook',
    'dsn',
    'vault',
    'salt',
    'private',
    'cert',
    'database',
    'connection',
    'mongo',
    's3',
    'bucket',
  ];
  const words = splitIdentifier(name);
  return words.some((w) => sensitive.includes(w));
}

function extractStringLiteral(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(/^(['"`])(.*)\1$/s);
  return m ? m[2] : null;
}

function looksLikeSecretLiteral(str: string): boolean {
  const noSpace = !/\s/.test(str);
  // JWT-like
  if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(str)) return true;
  // Long mixed token
  const longMixed =
    str.length >= 20 &&
    [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(str))
      .length >= 2 &&
    noSpace;
  if (longMixed) return true;
  // Config URLs
  if (/^https?:\/\//i.test(str) && !/localhost|127\.0\.0\.1/i.test(str)) {
    if (/(api|auth|oauth|db|graphql|issuer|login|token|endpoint)/i.test(str))
      return true;
  }
  return false;
}

// -------------------- Severity helpers --------------------
const SUSPICIOUS_NAMES: {
  regex: RegExp;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}[] = [
  { regex: /secret/i, severity: 'MEDIUM' },
  { regex: /token/i, severity: 'MEDIUM' },
  { regex: /api[-_]?key/i, severity: 'MEDIUM' },
  { regex: /password/i, severity: 'MEDIUM' },
  { regex: /private/i, severity: 'HIGH' },
  { regex: /client[-_]?secret/i, severity: 'HIGH' },
  { regex: /^[^\s]{40,}$/, severity: 'CRITICAL' },
  { regex: /^[^\s]{20,}$/, severity: 'HIGH' },
  { regex: /jwt/i, severity: 'HIGH' },
  { regex: /bearer/i, severity: 'HIGH' },
  { regex: /dsn/i, severity: 'HIGH' },
  { regex: /connection/i, severity: 'HIGH' },
  { regex: /mongo/i, severity: 'HIGH' },
  { regex: /s3/i, severity: 'HIGH' },
  { regex: /bucket/i, severity: 'HIGH' },
];

const SUSPICIOUS_VALUES: {
  regex: RegExp;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}[] = [
  { regex: /^[A-Za-z0-9-_]{40,}$/, severity: 'CRITICAL' },
  { regex: /^[A-Za-z0-9-_]{20,}$/, severity: 'HIGH' },
  {
    regex: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
    severity: 'HIGH',
  },
];

// Reduce redundant lines of code by using this function for usage checks...
function addUsage(m: any, result: EnvScanResult, fullPath: string) {
  const varName = m[1];
      if (!result[varName]) result[varName] = { usage: [], suggested: [] };
      if (!result[varName].usage.includes(fullPath)) result[varName].usage.push(fullPath);
}

/**
 * Scans the given directory for environment variable usage and suggestions.
 * @param dir The directory to scan.
 * @returns An object mapping environment variable names to their usage and suggestions.
 */
export function scanForEnv(dir: string): EnvScanResult {
  const result: EnvScanResult = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const nested = scanForEnv(path.join(dir, entry.name));
      for (const k in nested) {
        if (!result[k]) result[k] = { usage: [], suggested: [] };
        result[k].usage.push(...nested[k].usage);
        result[k].suggested.push(...nested[k].suggested);
      }
      continue;
    }

    const extMatch = entry.name.match(/\.(\w+)$/);
    if (!extMatch) continue;
    let ext = extMatch[1].toLowerCase();

    if (!MATCHERS[ext]) continue;

    const fullPath = path.join(dir, entry.name);
    const content = fs.readFileSync(fullPath, "utf-8");
    const code = stripComments(content);

    // -------------------- USAGE --------------------
    // JS/TS process.env. usage
    for (const m of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      addUsage(m, result, fullPath);
    }

    // Python os.environ usage
    for (const m of code.matchAll(/os\.environ\[['"]([A-Z0-9_]+)['"]\]/g)) {
      addUsage(m, result, fullPath);
    }

    // Shell $VAR usage
    for (const m of code.matchAll(/\$([A-Z0-9_]+)/g)) {
      addUsage(m, result, fullPath);
    }

    // -------------------- SUGGESTIONS --------------------
    const regexes = MATCHERS[ext];
    for (const regex of regexes) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(code))) {
        let key: string | undefined;
        let initializer: string | undefined;

        // JS/TS/JSX/TSX use different capture groups
        if (["js","ts"].includes(ext)) {
          key = match[2];
          initializer = match[3]?.trim();
        } else {
          key = match[1];
          initializer = match[2]?.trim();
        }

        // Skip if initializer is an env usage
        if (initializer && /process\.env\.[A-Z0-9_]+/.test(initializer)) {
          continue;
        }
        if (initializer && /os\.environ\[['"][A-Z0-9_]+['"]\]/.test(initializer)) {
          continue;
        }
        if (initializer && /\$[A-Z0-9_]+/.test(initializer)) {
          continue;
        }

        if (!key) continue;

        // Determine literal value
        const literal = initializer ? extractStringLiteral(initializer) : undefined;

        // -------------------- SEVERITY --------------------
        let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined;

        // Name-based severity
        for (const { regex: r, severity: s } of SUSPICIOUS_NAMES) {
          if (r.test(key)) severity = s;
        }

        // Value-based severity
        if (literal) {
          for (const { regex: r, severity: s } of SUSPICIOUS_VALUES) {
            if (r.test(literal)) severity = s;
          }
        }

        // Fallback
        if (!severity && (looksSensitiveName(key) || (literal && looksLikeSecretLiteral(literal)))) {
          severity = "MEDIUM";
        }

        if (severity) {
          if (!result[key]) result[key] = { usage: [], suggested: [] };
          const suggestion = { file: fullPath, severity };
          if (!result[key].suggested.some(s => s.file === fullPath)) {
            result[key].suggested.push(suggestion);
          }
        }
      }
    }
  }

  return result;
}

