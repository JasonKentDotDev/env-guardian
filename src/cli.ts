#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { scanForEnv } from "./index";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .name("@jkdd/env-guardian")
  .description("Scan your project for environment variable usage and candidates")
  .version("1.0.6");

program
  .command("scan")
  .argument("<dir>", "directory to scan")
  // Optional value for --to-env; defaults to ".env" if not specified
  .option("--to-env [name]", "create or append suggestions to user defined .env file (default: .env)")
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
            ` (found in: ${entry.suggested.map((f) => path.relative(dir, f)).join(", ")})`
        );
      }
    }

    // If there are existing variables detected, this section will print
    if (existing.length > 0) {
      console.log(chalk.bold.green("Existing Environment Variables:"));
      console.log(existing.join("\n"));
      console.log();
    }

    // If there are suggestions detected, this section will print
    if (suggestions.length > 0) {
      console.log(chalk.bold.yellow("⚠ Suggested Environment Variables:"));
      console.log(suggestions.join("\n"));
      console.log();
    }

    if (options.toEnv) {
      const envFile = typeof options.toEnv === "string" ? options.toEnv : ".env"; // If user just wrote --to-env, file will default to ".env"
      const envPath = path.join(process.cwd(), envFile); // always root folder and user defined name (.env.local, .env.production, etc.)

      let existingContent = "";
      if (fs.existsSync(envPath)) {
        existingContent = fs.readFileSync(envPath, "utf-8");
      }

      const newSuggestions = Object.entries(results)
        .filter(([key, entry]) => entry.suggested && !existingContent.includes(`${key}=`))
        .map(([key]) => `${key}=`);

      if (newSuggestions.length > 0) {
        // Append new suggestions to the defined .env file
        const envComment = "\n\n# Suggested by env-guardian\n";
        fs.appendFileSync(envPath, envComment + newSuggestions.join("\n") + "\n");
        console.log(chalk.yellow(`✨ Added ${newSuggestions.length} suggestion(s) to ${envFile}`));
      } else {
        // All suggestions already exist in the file
        console.log(chalk.gray(`No new suggestions to add to ${envFile}`));
      }
    }
  });

program.parse();
