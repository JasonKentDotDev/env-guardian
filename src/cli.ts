#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import readline from "readline";
import { scanForEnv } from './index';

interface IgnoreConfig {
  variables: string[];
  files: string[];
}

interface ScanConfig {
  ignore: IgnoreConfig;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

let ignoreConfig: IgnoreConfig = { variables: [], files: [] };

let scanConfig: ScanConfig = { ignore: IgnoreConfig, priority?: undefined };

function saveScanConfig() {
  fs.writeFileSync(".envscanconfig.json", JSON.stringify(scanConfig, null, 2));
};

function loadScanConfig() {
  if (fs.existsSync(".envscanconfig.json")) {
    scanConfig = JSON.parse(fs.readFileSync(".envscanconfig.json", "utf-8"));
  }
};

try {
  const ignoreConfigPath = path.resolve('.envscanignore.json');
  if (fs.existsSync(ignoreConfigPath)) {
    const raw = JSON.parse(fs.readFileSync(ignoreConfigPath, 'utf8'));
    const loaded = raw.ignore || {};
    ignoreConfig = {
      variables: Array.isArray(loaded.variables) ? loaded.variables : [],
      files: Array.isArray(loaded.files) ? loaded.files : [],
    };
  }
} catch (e) {
  console.warn('Could not load ignore config:', e);
};

function isIgnored(variable: string, file: string): boolean {
  if (variable && ignoreConfig.variables.includes(variable)) {
    return true;
  }

  if (file) {
    const absFile = path.resolve(file);
    return ignoreConfig.files.some(
      (ignoredFile) => path.resolve(ignoredFile) === absFile
    );
  }

  return false;
};


function saveIgnoreConfig() {
  const ignoreConfigPath = path.resolve('.envscanignore.json');
  fs.writeFileSync(
    ignoreConfigPath,
    JSON.stringify({ ignore: ignoreConfig }, null, 2)
  );
  console.log(chalk.blue(`✨ Updated ignore config at ${ignoreConfigPath}`));
};

const SEVERITY_ORDER = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const VALID_ENV_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".bashrc",
  ".zshrc",
  "config.json",
  "config.yaml",
  "config.yml",
  "secrets.json",
  "application.yaml",
  "application.yml",
  "application.properties",
  "appsettings.json"
]);

const program = new Command();

program
  .name('@jkdd/env-guardian')
  .description('A simple CLI program that helps you catch potential senitive values before they are pushed up to your repo publicly.')
  .version('1.2.0', '-v, --version', 'Output the current version')
  .helpOption(false)
  .option('-h, --help', 'Show help for available commands', () => {
    console.log(`
    Helpers:
      $ env-guardian --version, -v                          ## Displays current env-guardian version
      $ env-guardian --help, -h                             ## Help. It's self explanatory.
      $ env-guardian --info, -i                             ## Displays information about env-guardian
      $ env-guardian --valid-env                            ## Displays the list of valid .env file names

    Commands:
      $ env-guardian scan                                   ## Scans current directory
      $ env-guardian scan ./dir                             ## Scans a given directory
      $ env-guardian scan ./dir --to-env                    ## Adds Suggestions to default .env
      $ env-guardian scan ./dir --to-env .env.local         ## Adds Suggestions to given .env.*
      $ env-guardian ignore variable                        ## Adds variable(s) to an ignore list
      $ env-guardian ignore-files path/to/file.js           ## Adds file(s) to an ignore list
      $ env-guardian ignore-list                            ## Lists all ignored variables and files
      $ env-guardian reset-ignore                           ## Resets ignore list to ignore nothing
      $ env-guardian reset-ignore -f, --force               ## Skips confirmation to reset ignore list

    Tips:
      • Use 'scan' to analyze your project and suggest sensitive vars
      • Use '--to-env' flag to add suggested sensitive vars to a .env file
      • Use 'ignore' or 'ignore-files' to suppress false positives
      • Run 'reset-ignore' to restore a clean ignore config
    `);
    process.exit(0);
  })
  .option("-i, --info", "Show program information", () => {
    console.log(`
      Name: Env-Guardian
      Author: Jason Kent <jasonkent.dev@gmail.com>
      Version: 1.2.0
      Description: 'A simple CLI program that helps you catch potential senitive values before they are pushed up to your repo publicly.'
      License: 'MIT'
      GitHub Repo: 'https://github.com/JasonKentDotDev/env-guardian'
      Documentation: 'https://env-guardian.online/'
    `);
    process.exit(0);
  })
  .option("--valid-env", "Display list of valid filenames for secret files.", () => {
    console.log(`${chalk.cyan(`
      ✔ Valid Filename conventions:
    `)} ${chalk.yellow(`
      ${Array.from(VALID_ENV_FILES).join(`\n      `)}
    `)}
      For more info about .env filenames, check out: ${chalk.blueBright('https://env-guardian.online/docs/env-naming-conventions/env-files')}
    `);
    process.exit(0);
  });

program
  .command('scan')
  .argument('[dir]', 'directory to scan', '.')
  .option('--to-env [name]', 'create or append suggestions to user defined .env file (default: .env)')
  .action((dir, options) => {
    try {
      const results = scanForEnv(dir);

      console.log(chalk.bold('\n------------Environment Variable Report------------\n'));

      const existing: string[] = [];
      const suggestions: string[] = [];

      for (const [variable, entry] of Object.entries(results)) {
        // Find the highest severity for suggestions
        let maxSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined;

        if (entry.suggested.length > 0) {
          maxSeverity = entry.suggested.reduce((acc, s) => {
            if (!s.severity) return acc;
            return SEVERITY_ORDER[s.severity] > SEVERITY_ORDER[acc] ? s.severity : acc;
          }, "LOW" as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL");
        }

        // Apply filter if set
        if (
          scanConfig.priority &&
          maxSeverity &&
          SEVERITY_ORDER[maxSeverity] < SEVERITY_ORDER[scanConfig.priority]
        ) {
          continue; // skip this result
        }

        if (entry.usage.length > 0) {
          existing.push(
            chalk.green(`✔ ${variable}`) +
              ` (used in: ${entry.usage.map((f) => path.relative(dir, f)).join(', ')})`
          );
        } else if (entry.suggested.length > 0) {
          const allFiles = entry.suggested.map((s) => s.file);

          if (isIgnored(variable, '') || allFiles.some((f) => isIgnored('', f))) {
            continue;
          }

          let maxSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
          for (const s of entry.suggested) {
            if (s.severity === 'CRITICAL') maxSeverity = 'CRITICAL';
            else if (s.severity === 'HIGH' && maxSeverity !== 'CRITICAL') maxSeverity = 'HIGH';
            else if (s.severity === 'MEDIUM' && !['CRITICAL', 'HIGH'].includes(maxSeverity)) maxSeverity = 'MEDIUM';
          }

          const coloredLabel =
            maxSeverity === 'CRITICAL'
              ? chalk.red(`[${maxSeverity}]`)
              : maxSeverity === 'HIGH'
              ? chalk.hex('#FFA500')(`[${maxSeverity}]`)
              : maxSeverity === 'MEDIUM'
              ? chalk.yellow(`[${maxSeverity}]`)
              : chalk.green(`[${maxSeverity}]`);

          const files = entry.suggested.map((s) => path.relative(dir, s.file)).join(', ');
          suggestions.push(`${coloredLabel} ${chalk.yellow(variable)} (found in: ${files})`);
        }
      }

      if (existing.length > 0) {
        console.log(chalk.bold.green('Existing Environment Variables:'));
        console.log(existing.join('\n'));
        console.log();
      }

      if (suggestions.length > 0) {
        console.log(chalk.bold.yellow('⚠ Suggested Environment Variables:'));
        console.log(suggestions.join('\n'));
        console.log();
      }

      if (options.toEnv) {
        const envFile = typeof options.toEnv === 'string' ? options.toEnv : '.env';
        const envPath = path.join(process.cwd(), envFile);

        if (!VALID_ENV_FILES.has(envFile)) {
          console.log(chalk.red(`
  ❌ Invalid env file name: ${envFile}.
  Only the following are allowed: ${Array.from(VALID_ENV_FILES).join(", ")}
          `))
        } else {
          let existingContent = '';
          if (fs.existsSync(envPath)) {
            existingContent = fs.readFileSync(envPath, 'utf-8');
          }

          const newSuggestions = Object.entries(results)
            .filter(([variable, entry]) => {
              const allFiles = entry.suggested.map((s) => s.file);
              return (
                entry.suggested.length > 0 &&
                !existingContent.includes(`${variable}=`) &&
                !isIgnored(variable, '') &&
                !allFiles.some((f) => isIgnored('', f))
              );
            })
            .map(([variable, entry]) => {
              const values = entry.suggested
                .map((v) => v.value)
                .filter(Boolean);
              
              if (values.length > 0) {
                return `\n${variable}=${values[0]}`;
              }
              return `${variable}="Error grabbing value. Fill me in yourself!"`;
            });

          if (newSuggestions.length > 0) {
            const envComment = `\n\n
# Suggested by env-guardian
# Next Steps include: Renaming envs to their correct format and adding values the scanner didn't manage to grab.
# For more info on correct formatting of Environment Variables for your language, 
# visit: https://env-guardian.online/docs/env-naming-conventions/env-variables
`;
            fs.appendFileSync(envPath, envComment + newSuggestions.join('\n') + '\n');
            console.log(chalk.yellow(`✨ Added ${newSuggestions.length} suggestion(s) to ${envFile}`));
          } else {
            console.log(chalk.gray(`No new suggestions to add to ${envFile}`));
          }
        }
      }
    } catch (e) {
      console.error(chalk.red('❌ [ERROR] scan failed:'), e);
    }
  });

program
  .command("set-priority <level>")
  .description("Set minimum severity level to display (low, medium, high, critical)")
  .action((level: string) => {
    const upper = level.toUpperCase();
    const valid: ("LOW" | "MEDIUM" | "HIGH" | "CRITICAL")[] = [
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ];

    if (!valid.includes(upper as any)) {
      console.log(chalk.red(`❌ Invalid priority "${level}". Use one of: low, medium, high, critical`));
      process.exit(1);
    }

    scanConfig.priority = upper as any;
    saveScanConfig();
    console.log(chalk.green(`✔ Priority set to ${upper}`));
  });

program
  .command("reset-priority")
  .description("Reset severity filter to show all results")
  .action(() => {
    scanConfig.priority = undefined;
    saveScanConfig();
    console.log(chalk.cyan("🔄 Priority filter reset. All severities will be shown."));
  });

program
  .command("ignore [variables...]")
  .description("Ignore one or more environment variables")
  .action((variables: string[]) => {
    const variablesToIgnore = variables.map((v) => v.trim()).filter(Boolean);

    for (const v of variablesToIgnore) {
      if (!ignoreConfig.variables.includes(v)) {
        ignoreConfig.variables.push(v);
        console.log(chalk.green(`✔ Now ignoring ${v}`));
      } else {
        console.log(chalk.gray(`${v} is already ignored`));
      }
    }

    saveIgnoreConfig();
  });

program
  .command("ignore-files [files...]")
  .description("Ignore ALL variables in one or more files")
  .action((files: string[]) => {
    const filesToIgnore = files.map((f) => path.relative(process.cwd(), path.resolve(f)));

    for (const f of filesToIgnore) {
      if (!ignoreConfig.files.includes(f)) {
        ignoreConfig.files.push(f);
        console.log(chalk.green(`✔ Now ignoring ALL variables in ${f}`));
      } else {
        console.log(chalk.gray(`ALL variables in ${f} are already ignored`));
      }
    }

    saveIgnoreConfig();
  });

program
  .command("ignore-list")
  .description("List all currently ignored variables and files")
  .action(() => {
    if (ignoreConfig.variables.length === 0 && ignoreConfig.files.length === 0) {
      console.log(chalk.gray("No ignore rules configured."));
      return;
    }

    console.log(chalk.bold("\n🛑 Currently Ignored Rules:\n"));

    for (const v of ignoreConfig.variables) {
      console.log(chalk.green(`• ${v} (globally)`));
    }
    for (const f of ignoreConfig.files) {
      console.log(chalk.cyan(`• ALL variables in ${f}`));
    }

    console.log();
  });

program
  .command("unignore [variables...]")
  .description("Stop ignoring one or more environment variables")
  .action((variables: string[]) => {
    const variablesToUnignore = variables.map((v) => v.trim()).filter(Boolean);

    for (const v of variablesToUnignore) {
      if (ignoreConfig.variables.includes(v)) {
        ignoreConfig.variables = ignoreConfig.variables.filter((item) => item !== v);
        console.log(chalk.green(`✔ No longer ignoring ${v}`));
      } else {
        console.log(chalk.gray(`${v} was not in the ignore list`));
      }
    }

    saveIgnoreConfig();
  });

program
  .command("unignore-files [files...]")
  .description("Stop ignoring ALL variables in one or more files")
  .action((files: string[]) => {
    const filesToUnignore = files.map((f) =>
      path.relative(process.cwd(), path.resolve(f))
    );

    for (const f of filesToUnignore) {
      if (ignoreConfig.files.includes(f)) {
        ignoreConfig.files = ignoreConfig.files.filter((item) => item !== f);
        console.log(chalk.green(`✔ No longer ignoring ALL variables in ${f}`));
      } else {
        console.log(chalk.gray(`File ${f} was not in the ignore list`));
      }
    }

    saveIgnoreConfig();
  });


program
  .command("reset-ignore")
  .description("Reset ignore config to default values")
  .option("-f, --force", "skip confirmation")
  .action((options) => {
    const doReset = () => {
      const defaultConfig: IgnoreConfig = {
        variables: [],
        files: [],
      };
      ignoreConfig = defaultConfig;
      saveIgnoreConfig();
      console.log(chalk.cyan("🔄 ALL rules in `.envscanignore.json` have been reset"));
      console.log(chalk.cyan("✅ Reset complete"));
    };

    if (options.force) {
      doReset();
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("This will overwrite .envscanignore.json. Continue? (y/N) ", (ans) => {
        rl.close();
        if (ans.toLowerCase() === "y") doReset();
        else console.log(chalk.red("❌ Reset canceled"));
      });
    }
  });

program.parse(process.argv);
