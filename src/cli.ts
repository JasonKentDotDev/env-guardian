#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { scanForEnv } from "./index";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .name("@jkdd/env-guardian")
  .description("Scan your project for environment variable usage and candidates.")
  .version("1.0.8");

program
  .command("scan")
  .argument("[dir]", "directory to scan", ".") // optional arg, defaults to "."
  .option(
    "--to-env [name]",
    "create or append suggestions to user defined .env file (default: .env)"
  )
  .action((dir, options) => {
    const results = scanForEnv(dir);

    console.log(chalk.bold("\nEnvironment Variable Report:\n"));

    const existing: string[] = [];
    const suggestions: string[] = [];

    for (const [key, entry] of Object.entries(results)) {
      if (entry.usage.length > 0) {
        existing.push(
          chalk.green(`✔ ${key}`) +
            ` (used in: ${entry.usage.map((f) => path.relative(dir, f)).join(", ")})`
        );
      } else if (entry.suggested.length > 0) {
        suggestions.push(
          chalk.yellow(`${key}`) +
            ` (found in: ${entry.suggested.map((f: any) => path.relative(dir, f.file || f)).join(", ")})`
        );
      }
    }

    // Print existing usage
    if (existing.length > 0) {
      console.log(chalk.bold.green("Existing Environment Variables:"));
      console.log(existing.join("\n"));
      console.log();
    }

    // Print suggestions
    if (suggestions.length > 0) {
      console.log(chalk.bold.yellow("⚠ Suggested Environment Variables:"));
      console.log(suggestions.join("\n"));
      console.log();
    }

    // Handle --to-env
    if (options.toEnv) {
      const envFile = typeof options.toEnv === "string" ? options.toEnv : ".env";
      const envPath = path.join(process.cwd(), envFile);

      let existingContent = "";
      if (fs.existsSync(envPath)) {
        existingContent = fs.readFileSync(envPath, "utf-8");
      }

      const newSuggestions = Object.entries(results)
        .filter(([key, entry]) => entry.suggested.length > 0 && !existingContent.includes(`${key}=`))
        .map(([key, entry]) => {
          // if you extended index.ts to include {file, value}, support that here
          const firstVal = (entry.suggested as any[]).find(s => s.value)?.value;
          return firstVal ? `${key}=${firstVal}` : `${key}=`;
        });

      if (newSuggestions.length > 0) {
        const envComment = "\n\n# Suggested by env-guardian\n";
        fs.appendFileSync(envPath, envComment + newSuggestions.join("\n") + "\n");
        console.log(chalk.yellow(`✨ Added ${newSuggestions.length} suggestion(s) to ${envFile}`));
      } else {
        console.log(chalk.gray(`No new suggestions to add to ${envFile}`));
      }
    }
  });

program.parse();
