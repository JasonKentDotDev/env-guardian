#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import readline from "readline";
import { scanForEnv, EnvScanResult } from "./index";

const program = new Command();

interface ScanConfig {
  ignore: {
    variables: string[];
    files: string[];
  };
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

const CONFIG_FILE = ".envscanconfig.json";

// ---------- Load/Save Config ----------
let scanConfig: ScanConfig = { ignore: { variables: [], files: [] } };

function saveScanConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(scanConfig, null, 2));
}

function loadScanConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    scanConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  }
}
loadScanConfig();

// ---------- Helpers ----------
function isIgnored(variable: string, file: string): boolean {
  if (variable && scanConfig.ignore.variables.includes(variable)) return true;
  if (file) {
    const absFile = path.resolve(file);
    return scanConfig.ignore.files.some(
      (ignoredFile) => path.resolve(ignoredFile) === absFile
    );
  }
  return false;
}

const SEVERITY_ORDER: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ---------- Commands ----------
program
  .command("scan [dir]")
  .description("Scan project for environment variables")
  .action((dir = ".") => {
    const results: EnvScanResult = scanForEnv(path.resolve(dir));

    const existing: string[] = [];
    const suggestions: string[] = [];

    for (const [key, entry] of Object.entries(results)) {
      // Ignore rules
      if (isIgnored(key, entry.usage[0] ?? entry.suggested[0]?.file ?? "")) continue;

      // Handle USAGE (always LOW severity)
      if (entry.usage.length > 0) {
        if (
          scanConfig.priority &&
          SEVERITY_ORDER["LOW"] < SEVERITY_ORDER[scanConfig.priority]
        ) {
          continue;
        }
        existing.push(
          chalk.green(`✔ ${key}`) +
            ` (used in: ${entry.usage.map((f) => path.relative(dir, f)).join(", ")})`
        );
      }

      // Handle SUGGESTIONS
      if (entry.suggested.length > 0) {
        let maxSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
        for (const s of entry.suggested) {
          if (s.severity && SEVERITY_ORDER[s.severity] > SEVERITY_ORDER[maxSeverity]) {
            maxSeverity = s.severity;
          }
        }

        if (
          scanConfig.priority &&
          SEVERITY_ORDER[maxSeverity] < SEVERITY_ORDER[scanConfig.priority]
        ) {
          continue;
        }

        const coloredLabel =
          maxSeverity === "CRITICAL"
            ? chalk.red(`[${maxSeverity}]`)
            : maxSeverity === "HIGH"
            ? chalk.hex("#FFA500")(`[${maxSeverity}]`)
            : maxSeverity === "MEDIUM"
            ? chalk.yellow(`[${maxSeverity}]`)
            : chalk.green(`[${maxSeverity}]`);

        suggestions.push(
          `${coloredLabel} ${chalk.yellow(key)} (found in: ${entry.suggested
            .map((s) => path.relative(dir, s.file))
            .join(", ")})`
        );
      }
    }

    console.log(chalk.bold("\n\n------------Environment Variable Report------------"));

    if (existing.length > 0) {
      console.log(chalk.green("\nExisting Environment Variables:"));
      existing.forEach((e) => console.log(e));
    }

    if (suggestions.length > 0) {
      console.log(chalk.yellow("\n⚠ Suggested Environment Variables:"));
      suggestions.forEach((s) => console.log(s));
    } else {
      console.log(chalk.green("\n🎉 Congrats! You have no suggestions detected! 🎉\n"))
    }
  });

// -------- Ignore/Unignore commands --------
program
  .command("ignore [variables...]")
  .description("Ignore one or more environment variables")
  .action((variables: string[]) => {
    const variablesToIgnore = variables.map((v) => v.trim()).filter(Boolean);

    for (const v of variablesToIgnore) {
      if (!scanConfig.ignore.variables.includes(v)) {
        scanConfig.ignore.variables.push(v);
        console.log(chalk.green(`✔ Now ignoring ${v}`));
      } else {
        console.log(chalk.gray(`${v} is already ignored`));
      }
    }

    saveScanConfig();
  });

program
  .command("ignore-files [files...]")
  .description("Ignore ALL variables in one or more files")
  .action((files: string[]) => {
    const filesToIgnore = files.map((f) =>
      path.relative(process.cwd(), path.resolve(f))
    );

    for (const f of filesToIgnore) {
      if (!scanConfig.ignore.files.includes(f)) {
        scanConfig.ignore.files.push(f);
        console.log(chalk.green(`✔ Now ignoring ALL variables in ${f}`));
      } else {
        console.log(chalk.gray(`ALL variables in ${f} are already ignored`));
      }
    }

    saveScanConfig();
  });

program
  .command("unignore [variables...]")
  .description("Stop ignoring one or more environment variables")
  .action((variables: string[]) => {
    for (const v of variables) {
      const index = scanConfig.ignore.variables.indexOf(v);
      if (index !== -1) {
        scanConfig.ignore.variables.splice(index, 1);
        console.log(chalk.green(`✔ No longer ignoring ${v}`));
      } else {
        console.log(chalk.gray(`${v} was not ignored`));
      }
    }
    saveScanConfig();
  });

program
  .command("unignore-files [files...]")
  .description("Stop ignoring one or more files")
  .action((files: string[]) => {
    const filesToUnignore = files.map((f) =>
      path.relative(process.cwd(), path.resolve(f))
    );

    for (const f of filesToUnignore) {
      const index = scanConfig.ignore.files.indexOf(f);
      if (index !== -1) {
        scanConfig.ignore.files.splice(index, 1);
        console.log(chalk.green(`✔ No longer ignoring ${f}`));
      } else {
        console.log(chalk.gray(`${f} was not ignored`));
      }
    }

    saveScanConfig();
  });

program
  .command("reset-ignore")
  .description("Reset ignore config to default values")
  .option("-f, --force", "skip confirmation")
  .action((options) => {
    const doReset = () => {
      scanConfig.ignore = { variables: [], files: [] };
      saveScanConfig();
      console.log(chalk.cyan("🔄 Ignore rules have been reset"));
    };

    if (options.force) {
      doReset();
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("This will overwrite ignore rules. Continue? (y/N) ", (ans) => {
        rl.close();
        if (ans.toLowerCase() === "y") doReset();
        else console.log(chalk.red("❌ Reset canceled"));
      });
    }
  });

// -------- Priority commands --------
program
  .command("set-priority <level>")
  .description("Set minimum severity level for results (low, medium, high, critical)")
  .action((level: string) => {
    const severityLevel = level.toUpperCase() as
      | "LOW"
      | "MEDIUM"
      | "HIGH"
      | "CRITICAL";
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severityLevel)) {
      console.error(
        chalk.red("❌ Invalid priority. Must be one of: low, medium, high, or critical")
      );
      process.exit(1);
    }
    scanConfig.priority = severityLevel;
    saveScanConfig();
    console.log(chalk.green(`\n✔ Priority set to [${severityLevel}]\n`));
  });

program
  .command("reset-priority")
  .description("Reset severity filter to show all results")
  .action(() => {
    scanConfig.priority = undefined;
    saveScanConfig();
    console.log(chalk.cyan("\n🔄 Priority filter reset. All severities will be shown on scan.\n"));
  });

program.parse(process.argv);
