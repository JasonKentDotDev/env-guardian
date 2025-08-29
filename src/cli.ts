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

let ignoreConfig: IgnoreConfig = { variables: [], files: [] };

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
}

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
}


function saveIgnoreConfig() {
  const ignoreConfigPath = path.resolve('.envscanignore.json');
  fs.writeFileSync(
    ignoreConfigPath,
    JSON.stringify({ ignore: ignoreConfig }, null, 2)
  );
  console.log(chalk.blue(`✨ Updated ignore config at ${ignoreConfigPath}`));
}

const program = new Command();

program
  .name('@jkdd/env-guardian')
  .description('A simple CLI program that helps you catch potential senitive values before they are pushed up to your repo publicly.')
  .version('1.1.13', '-v, --version', 'Output the current version')
  .helpOption(false)
  .option('-h, --help', 'Show help for available commands', () => {
    console.log(`
    Helpers:
      $ env-guardian --version, -v                          ## Displays current env-guardian version
      $ env-guardian --help, -h                             ## Help. It's self explanatory.
      $ env-guardian --info, -i                             ## Displays information about env-guardian

    Commands:
      $ env-guardian scan                                   ## Scans current directory
      $ env-guardian scan ./dir                             ## Scans a given directory
      $ env-guardian scan ./dir --to-env                    ## Adds Suggestions to default .env
      $ env-guardian scan ./dir --to-env .env.local         ## Adds Suggestions to given .env.*
      $ env-guardian ignore variable                        ## Adds variable(s) to an ignore list
      $ env-guardian ignore-files path/to/file.js           ## Adds file(s) to an ignore list
      $ env-guardian ignore-list                            ## Lists all ignored variables and files
      $ env-guardian reset-ignore                           ## Resets ignore list to ignore nothing

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
      Version: 1.1.13
      Description: 'A simple CLI program that helps you catch potential senitive values before they are pushed up to your repo publicly.'
      License: 'MIT'
      GitHub Repo: 'https://github.com/JasonKentDotDev/env-guardian'
      Documentation: 'https://env-guardian.online/'
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
    } catch (e) {
      console.error(chalk.red('❌ [ERROR] scan failed:'), e);
    }
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
      console.log(chalk.blueBright("🔄 ALL rules in `.envscanignore.json` have been reset"));
      console.log(chalk.blueBright("✅ Reset complete"));
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
