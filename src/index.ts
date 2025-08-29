import fs from "fs";
import path from "path";

export interface EnvScanResultEntry {
  usage: string[];
  suggested: {
    file: string;
    value?: string;
    severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  }[];
}

export type EnvScanResult = Record<string, EnvScanResultEntry>;

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

/**
 * Remove comments from source code for easier regex matching.
 */
function stripComments(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, ""); // line comments
}

/**
 * Split a variable name into lowercase words (camelCase, snake_case, etc.)
 */
function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/**
 * Common file matchers for different languages/configs.
 */
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

/**
 * Quick check if a variable name looks sensitive.
 */
function looksSensitiveName(name: string): boolean {
  const sensitive = [
    "secret",
    "token",
    "key",
    "password",
    "passwd",
    "pwd",
    "apikey",
    "api",
    "auth",
    "jwt",
    "bearer",
    "client",
    "issuer",
    "webhook",
    "dsn",
    "vault",
    "salt",
    "private",
    "cert",
    "database",
    "connection",
    "mongo",
    "s3",
    "bucket",
  ];
  return splitIdentifier(name).some((w) => sensitive.includes(w));
}

/**
 * Extracts a string literal without quotes.
 */
function extractStringLiteral(raw: string): string | null {
  const m = raw.trim().match(/^(['"`])(.*)\1$/s);
  return m ? m[2] : null;
}

/**
 * Heuristics for spotting secret-like string values.
 */
function looksLikeSecretLiteral(str: string): boolean {
  const noSpace = !/\s/.test(str);
  if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(str)) return true; // JWT
  if (
    str.length >= 20 &&
    [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(str)).length >= 2 &&
    noSpace
  )
    return true; // Long mixed token
  if (/^https?:\/\//i.test(str) && !/localhost|127\.0\.0\.1/i.test(str)) {
    return /(api|auth|oauth|db|graphql|issuer|login|token|endpoint)/i.test(str);
  }
  return false;
}

/**
 * Suspicious variable names (regex + severity).
 */
const SUSPICIOUS_NAMES = [
  // --- CRITICAL ---
  { regex: /^sk_[A-Za-z0-9]/, severity: "CRITICAL" },           // Stripe keys
  { regex: /^[A-Za-z0-9_\-]{32,}$/, severity: "CRITICAL" },     // long random tokens
  { regex: /(PRIVATE|SECRET).*KEY/i, severity: "CRITICAL" },    // SECRET_KEY, PRIVATE_KEY
  { regex: /^SECRET.*$/i, severity: "CRITICAL" },               // anything starting with SECRET_
  { regex: /^.*_SECRET.*$/i, severity: "CRITICAL" },            // *_SECRET_*
  { regex: /password/i, severity: "CRITICAL" },
  { regex: /secret/i, severity: "CRITICAL" },
  { regex: /^(TOKEN|ACCESS_TOKEN|API_TOKEN|JSON_TOKEN)$/i, severity: "CRITICAL" },
  { regex: /^.*_TOKEN$/i, severity: "CRITICAL" },               // *_TOKEN (SECRET_API_TOKEN etc.)

  // --- HIGH ---
  { regex: /api[-_]?key/i, severity: "HIGH" },
  { regex: /token/i, severity: "HIGH" },                        // descriptive tokens (csrfToken, nextPageToken)
  { regex: /private/i, severity: "HIGH" },
  { regex: /client[-_]?secret/i, severity: "HIGH" },
  { regex: /^.{20,}$/, severity: "HIGH" },                      // reasonably long values
  { regex: /jwt/i, severity: "HIGH" },
  { regex: /bearer/i, severity: "HIGH" },
  { regex: /dsn/i, severity: "HIGH" },
  { regex: /connection/i, severity: "HIGH" },
  { regex: /mongo/i, severity: "HIGH" },
  { regex: /s3/i, severity: "HIGH" },
  { regex: /bucket/i, severity: "HIGH" },

  // --- MEDIUM ---
  { regex: /key/i, severity: "MEDIUM" },
  { regex: /id/i, severity: "MEDIUM" },
  { regex: /user(name)?/i, severity: "MEDIUM" },
  { regex: /account/i, severity: "MEDIUM" },
  { regex: /profile/i, severity: "MEDIUM" },
  { regex: /email/i, severity: "MEDIUM" },
  { regex: /phone/i, severity: "MEDIUM" },
  { regex: /project/i, severity: "MEDIUM" },
  { regex: /org(anization)?/i, severity: "MEDIUM" },
  { regex: /workspace/i, severity: "MEDIUM" },
  { regex: /region/i, severity: "MEDIUM" },
  { regex: /locale/i, severity: "MEDIUM" },
  { regex: /timezone/i, severity: "MEDIUM" },
  { regex: /cluster/i, severity: "MEDIUM" },
  { regex: /host/i, severity: "MEDIUM" },
  { regex: /server/i, severity: "MEDIUM" },
  { regex: /instance/i, severity: "MEDIUM" },
  { regex: /url/i, severity: "MEDIUM" },
  { regex: /uri/i, severity: "MEDIUM" },
  { regex: /schema/i, severity: "MEDIUM" },

  // --- LOW ---
  { regex: /port/i, severity: "LOW" },
  { regex: /version/i, severity: "LOW" },
  { regex: /mode/i, severity: "LOW" },
  { regex: /flag/i, severity: "LOW" },
  { regex: /color/i, severity: "LOW" },
  { regex: /theme/i, severity: "LOW" },
  { regex: /lang(uage)?/i, severity: "LOW" },
  { regex: /path/i, severity: "LOW" },
  { regex: /dir(ectory)?/i, severity: "LOW" },
  { regex: /file/i, severity: "LOW" },
  { regex: /cache/i, severity: "LOW" },
  { regex: /temp/i, severity: "LOW" },
  { regex: /timeout/i, severity: "LOW" },
  { regex: /retry/i, severity: "LOW" },
  { regex: /limit/i, severity: "LOW" },
  { regex: /offset/i, severity: "LOW" },
] as const;

/**
 * Suspicious literal values.
 */
const SUSPICIOUS_VALUES = [
  { regex: /^[A-Za-z0-9-_]{40,}$/, severity: "CRITICAL" },
  { regex: /^[A-Za-z0-9-_]{20,}$/, severity: "HIGH" },
  { regex: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/, severity: "HIGH" },
] as const;

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;

function maxSeverity(
  a?: keyof typeof SEVERITY_RANK,
  b?: keyof typeof SEVERITY_RANK
): keyof typeof SEVERITY_RANK | undefined {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Runs a target string against a list of suspicious rules.
 */
function getSeverityFromRules<T extends { regex: RegExp; severity: keyof typeof SEVERITY_RANK }>(
  target: string,
  rules: readonly T[]
): keyof typeof SEVERITY_RANK | undefined {
  let severity: keyof typeof SEVERITY_RANK | undefined;
  for (const { regex, severity: s } of rules) {
    if (regex.test(target)) severity = maxSeverity(severity, s);
  }
  return severity;
}

/**
 * Add variable usage in result set.
 */
function addUsage(m: RegExpMatchArray, result: EnvScanResult, file: string) {
  const name = m[1];
  result[name] ??= { usage: [], suggested: [] };
  if (!result[name].usage.includes(file)) result[name].usage.push(file);
}

/**
 * Remove Vue template/style blocks before scanning.
 */
function stripVueSections(src: string) {
  return src.replace(/<template[\s\S]*?<\/template>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
}

/**
 * Scans a directory for environment variable usage and secrets.
 */
export function scanForEnv(dir: string): EnvScanResult {
  const result: EnvScanResult = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const nested = scanForEnv(path.join(dir, entry.name));
      for (const k in nested) {
        result[k] ??= { usage: [], suggested: [] };
        result[k].usage.push(...nested[k].usage);
        result[k].suggested.push(...nested[k].suggested);
      }
      continue;
    }

    const ext = entry.name.match(/\.(\w+)$/)?.[1]?.toLowerCase();
    if (!ext) continue;

    const mappedExt = ext === "jsx" ? "js" : ext === "tsx" ? "ts" : ext;
    if (!MATCHERS[mappedExt]) continue;

    const fullPath = path.join(dir, entry.name);
    let code = stripComments(fs.readFileSync(fullPath, "utf-8"));
    if (mappedExt === "vue") code = stripVueSections(code);

    // -------------------- USAGE --------------------
    const USAGE_PATTERNS: RegExp[] = [
      /process\.env\.([A-Z0-9_]+)/g, // JS/TS
      /os\.environ\[['"]([A-Z0-9_]+)['"]\]/g, // Python
      /\$([A-Z0-9_]+)/g, // Shell
    ];
    for (const pat of USAGE_PATTERNS) {
      for (const m of code.matchAll(pat)) addUsage(m, result, fullPath);
    }

    // -------------------- SUGGESTIONS --------------------
    for (const regex of MATCHERS[mappedExt]) {
      for (let m; (m = regex.exec(code)); ) {
        const key = ["js", "ts"].includes(mappedExt) ? m[2] : m[1];
        const initializer = (["js", "ts"].includes(mappedExt) ? m[3] : m[2])?.trim();
        if (!key || (initializer && /(process\.env|os\.environ|\$[A-Z0-9_]+)/.test(initializer))) continue;

        const literal = initializer ? extractStringLiteral(initializer) ?? undefined : undefined;

        let severity = getSeverityFromRules(key, SUSPICIOUS_NAMES);
        if (literal) severity = maxSeverity(severity, getSeverityFromRules(literal, SUSPICIOUS_VALUES));
        if (!severity && (looksSensitiveName(key) || (literal && looksLikeSecretLiteral(literal)))) severity = "MEDIUM";

        if (severity) {
          result[key] ??= { usage: [], suggested: [] };
          if (!result[key].suggested.some((s) => s.file === fullPath)) {
            result[key].suggested.push({ 
              file: fullPath, 
              value: literal,
              severity 
            });
          }
        }
      }
    }
  }

  return result;
}
