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

  // Vue.js
  vue: [
    /(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]*?)(?:;|\n|$)/g,
    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(['"`][^'"`]+['"`]|process\.env\.[A-Z0-9_]+)/g,
  ],
  
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

const SUSPICIOUS_NAMES: {
  regex: RegExp;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}[] = [
  // --- CRITICAL ---
  { regex: /^sk_[A-Za-z0-9]/, severity: 'CRITICAL' },                 // Stripe keys
  { regex: /^[A-Za-z0-9_\-]{32,}$/, severity: 'CRITICAL' },           // long random tokens (JWT, API tokens)
  { regex: /(PRIVATE|SECRET).*KEY/i, severity: 'CRITICAL' },          // SECRET_KEY, PRIVATE_KEY
  { regex: /^SECRET.*$/i, severity: 'CRITICAL' },                     // anything starting with SECRET_
  { regex: /^.*_SECRET.*$/i, severity: 'CRITICAL' },                  // *_SECRET_*
  { regex: /password/i, severity: 'CRITICAL' },                       // explicit password variables
  { regex: /secret/i, severity: 'CRITICAL' },                         // anything with "secret"
  { regex: /^(TOKEN|ACCESS_TOKEN|API_TOKEN|JSON_TOKEN)$/i, severity: 'CRITICAL' }, // bare tokens
  { regex: /^.*_TOKEN$/i, severity: 'CRITICAL' },                     // *_TOKEN (SECRET_API_TOKEN etc.)

  // --- HIGH ---
  { regex: /api[-_]?key/i, severity: 'HIGH' },
  { regex: /token/i, severity: 'HIGH' },      // descriptive tokens (csrfToken, nextPageToken)
  { regex: /private/i, severity: 'HIGH' },
  { regex: /client[-_]?secret/i, severity: 'HIGH' },
  { regex: /^.{20,}$/, severity: 'HIGH' },    // reasonably long values
  { regex: /jwt/i, severity: 'HIGH' },
  { regex: /bearer/i, severity: 'HIGH' },
  { regex: /dsn/i, severity: 'HIGH' },
  { regex: /connection/i, severity: 'HIGH' },
  { regex: /mongo/i, severity: 'HIGH' },
  { regex: /s3/i, severity: 'HIGH' },
  { regex: /bucket/i, severity: 'HIGH' },

  // --- MEDIUM ---
  { regex: /key/i, severity: 'MEDIUM' },
  { regex: /id/i, severity: 'MEDIUM' },
  { regex: /user(name)?/i, severity: 'MEDIUM' },
  { regex: /account/i, severity: 'MEDIUM' },
  { regex: /profile/i, severity: 'MEDIUM' },
  { regex: /email/i, severity: 'MEDIUM' },
  { regex: /phone/i, severity: 'MEDIUM' },
  { regex: /project/i, severity: 'MEDIUM' },
  { regex: /org(anization)?/i, severity: 'MEDIUM' },
  { regex: /workspace/i, severity: 'MEDIUM' },
  { regex: /region/i, severity: 'MEDIUM' },
  { regex: /locale/i, severity: 'MEDIUM' },
  { regex: /timezone/i, severity: 'MEDIUM' },
  { regex: /cluster/i, severity: 'MEDIUM' },
  { regex: /host/i, severity: 'MEDIUM' },
  { regex: /server/i, severity: 'MEDIUM' },
  { regex: /instance/i, severity: 'MEDIUM' },
  { regex: /url/i, severity: 'MEDIUM' },
  { regex: /uri/i, severity: 'MEDIUM' },
  { regex: /schema/i, severity: 'MEDIUM' },

  // --- LOW ---
  { regex: /id/i, severity: 'LOW' },
  { regex: /port/i, severity: 'LOW' },
  { regex: /version/i, severity: 'LOW' },
  { regex: /mode/i, severity: 'LOW' },
  { regex: /flag/i, severity: 'LOW' },
  { regex: /color/i, severity: 'LOW' },
  { regex: /theme/i, severity: 'LOW' },
  { regex: /lang(uage)?/i, severity: 'LOW' },
  { regex: /path/i, severity: 'LOW' },
  { regex: /dir(ectory)?/i, severity: 'LOW' },
  { regex: /file/i, severity: 'LOW' },
  { regex: /cache/i, severity: 'LOW' },
  { regex: /temp/i, severity: 'LOW' },
  { regex: /timeout/i, severity: 'LOW' },
  { regex: /retry/i, severity: 'LOW' },
  { regex: /limit/i, severity: 'LOW' },
  { regex: /offset/i, severity: 'LOW' },
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

const SEVERITY_RANK: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxSeverity(
  a?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  b?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function getSeverityFromRules(
  target: string,
  rules: { regex: RegExp; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }[]
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined {
  let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined;
  for (const { regex, severity: s } of rules) {
    if (regex.test(target)) {
      severity = maxSeverity(severity, s);
    }
  }
  return severity;
}

// Reduce redundant lines of code by using this function for usage checks...
function addUsage(m: any, result: EnvScanResult, fullPath: string) {
  const varName = m[1];
      if (!result[varName]) result[varName] = { usage: [], suggested: [] };
      if (!result[varName].usage.includes(fullPath)) result[varName].usage.push(fullPath);
}

// Formatter for Vue data to be scanned and output correctly
function stripVueSections(src: string) {
  return src
    .replace(/<template[\s\S]*?<\/template>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
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

    // Map JSX/TSX to JS/TS
    if (ext === "jsx") ext = "js";
    if (ext === "tsx") ext = "ts";


    if (!MATCHERS[ext]) continue;

    const fullPath = path.join(dir, entry.name);
    const content = fs.readFileSync(fullPath, "utf-8");
    let code = stripComments(content);

    if (ext === "vue") {
      code = stripVueSections(code);
    }

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

        // Check name
        severity = maxSeverity(severity, getSeverityFromRules(key, SUSPICIOUS_NAMES));

        // Check value
        if (literal) {
          severity = maxSeverity(severity, getSeverityFromRules(literal, SUSPICIOUS_VALUES));
        }

        // Fallback if nothing matched
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

