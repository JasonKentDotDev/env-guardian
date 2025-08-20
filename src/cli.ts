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
  .version("1.0.1");

program
  .command("scan")
  .argument("<dir>", "directory to scan")
  .option("--to-env", "create or append suggestions to .env file")
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
      } else if (entry.suggested) {
        suggestions.push(chalk.yellow(`${key} (candidate)`));
      }
    }

    if (existing.length > 0) {
      console.log(chalk.bold.green("Existing Environment Variables:"));
      console.log(existing.join("\n"));
      console.log();
    }

    if (suggestions.length > 0) {
      console.log(chalk.bold.yellow("⚠ Suggested Environment Variables:"));
      console.log(suggestions.join("\n"));
      console.log();
    }

    if (options.createEnv) {
      const envPath = ".env";
      let existingContent = "";
      if (fs.existsSync(envPath)) {
        existingContent = fs.readFileSync(envPath, "utf-8");
      }

      const newSuggestions = Object.entries(results)
        .filter(([key, entry]) => entry.suggested && !existingContent.includes(`${key}=`))
        .map(([key]) => `${key}=`);

      if (newSuggestions.length > 0) {
        const envComment = "\n\n# Suggested by env-guardian\n";
        fs.appendFileSync(envPath, envComment + newSuggestions.join("\n") + "\n");
        console.log(chalk.yellow(`✨ Added ${newSuggestions.length} suggestion(s) to .env`));
      } else {
        console.log(chalk.gray("No new suggestions to add to .env"));
      }
    }
  });

program.parse();
