import fs from "fs";
import path from "path";

export interface EnvScanResultEntry {
  usage: string[];
  suggested: { file: string; value?: string }[];
}

export type EnvScanResult = Record<string, EnvScanResultEntry>;

/**
 * Ignored Directories if scanning root folder
 * New suggestions are welcome for various projects
 */
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

function stripComments(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, ""); // line comments
}

/** Helps split variable names to help in identifying sensitive variables
 * camelCase   ->  camel case
 * snake_case  ->  snake case
 * kebab-case  ->  kebab case
 */
function splitIdentifier(name: string): string[] {
  // Split identifier into words based on common patterns
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/**
 * Check if the variable name contains any sensitive keywords
 * This is a basic heuristic and can be extended based on project needs
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
  const words = splitIdentifier(name);
  return words.some((w) => sensitive.includes(w));
}

/**
 * Only evaluate string literals (quotes must match)
 */
function extractStringLiteral(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(/^(['"`])(.*)\1$/s);
  return m ? m[2] : null; // inner content w/o quotes
}

/**
 * Check if a string literal looks like a secret or sensitive value
 */
function looksLikeSecretLiteral(str: string): boolean {
  const noSpace = !/\s/.test(str);

  // jwt-like
  if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(str)) return true;

  // obvious API keys/long tokens
  const longMixed =
    str.length >= 20 &&
    [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(str))
      .length >= 2 &&
    noSpace;
  if (longMixed) return true;

  // URLs that look like config (avoid localhost)
  if (/^https?:\/\//i.test(str) && !/localhost|127\.0\.0\.1/i.test(str)) {
    // require something configy in host or path to avoid asset URLs
    if (/(api|auth|oauth|db|graphql|issuer|login|token|endpoint)/i.test(str))
      return true;
  }

  return false;
}

/**
 * Directory to scan for environment variable usage and candidates
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

    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const content = fs.readFileSync(fullPath, "utf-8");
    const code = stripComments(content);

    // Existing usage: process.env.VAR_NAME
    for (const m of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const varName = m[1];
      if (!result[varName]) result[varName] = { usage: [], suggested: [] };
      if (!result[varName].usage.includes(fullPath)) {
        result[varName].usage.push(fullPath);
      }
    }

    // Candidates: const/let/var name = <initializer>
    const candidateRegex =
      /(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+)/g;
    let m: RegExpExecArray | null;
    while ((m = candidateRegex.exec(code))) {
      const key = m[2];
      const initializer = m[3].trim();

      // Skip if this variable is directly assigned from process.env
      if (/^process\.env\.[A-Z0-9_]+$/.test(initializer)) {
        continue;
      }

      // if already used as env, skip suggesting
      if (result[key]?.usage.length) continue;

      // Sensitivity check
      const nameSensitive = looksSensitiveName(key);
      const literal = extractStringLiteral(initializer);
      const valueSensitive = literal ? looksLikeSecretLiteral(literal) : false;

      // If either name or value looks sensitive, suggest it as a candidate
      if (nameSensitive || valueSensitive) {
        if (!result[key]) result[key] = { usage: [], suggested: [] };
        
        const suggestion = { file: fullPath, value: literal ?? undefined };
        
        if (!result[key].suggested.some(s => s.file === fullPath)) {
          result[key].suggested.push(suggestion);
        }
      }
    }
  }

  return result;
}
