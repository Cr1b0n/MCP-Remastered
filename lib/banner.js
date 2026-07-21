import chalk from "chalk";

export const CREDITS = "MCP-Remastered · Cr1b0n & saad2001";

export function printBanner() {
  console.log("");
  console.log(chalk.cyanBright("  ███╗   ███╗ ██████╗██████╗ "));
  console.log(chalk.blueBright("  ████╗ ████║██╔════╝██╔══██╗"));
  console.log(chalk.magentaBright("  ██╔████╔██║██║     ██████╔╝"));
  console.log(chalk.blueBright("  ██║╚██╔╝██║██║     ██╔═══╝ "));
  console.log(chalk.cyanBright("  ██║ ╚═╝ ██║╚██████╗██║     "));
  console.log(chalk.magentaBright("  ╚═╝     ╚═╝ ╚═════╝╚═╝     ") + chalk.bold.white(" REMASTERED"));
  console.log("");
  console.log(chalk.gray(`  ${CREDITS}`));
  console.log(chalk.gray("  Decompile · Edit · Build · Run"));
  console.log(chalk.gray("  " + "─".repeat(44)));
  console.log("");
}
