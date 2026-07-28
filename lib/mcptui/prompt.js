import chalk from "chalk";
import { select as inqSelect, confirm as inqConfirm, input as inqInput, search as inqSearch } from "@inquirer/prompts";
import { palette, c, glyph } from "./theme.js";
import { contentIndent } from "./renderer.js";

function styleMessage(msg) {
  return msg ? chalk.hex(palette.primary).bold(msg) : msg;
}

const openCodeTheme = {
  style: {
    answer: (val) => c.text(val),
    message: (msg) => c.primary.bold(msg),
    error: (err) => c.error(`${glyph.cross} ${err}`),
    help: (help) => c.muted(`  ${help}`),
    highlight: (text) => c.primary.bold(text),
    description: (desc) => c.muted(`  ${desc}`),
  },
  icon: {
    cursor: c.primary(glyph.pointer),
  },
  prefix: c.primary(glyph.arrow),
};

export async function select(opts) {
  return inqSelect({
    ...opts,
    message: styleMessage(opts?.message),
    theme: {
      ...openCodeTheme,
      ...opts.theme,
    },
  });
}

export async function search(opts) {
  return inqSearch({
    ...opts,
    message: styleMessage(opts?.message),
    theme: {
      ...openCodeTheme,
      ...opts.theme,
    },
  });
}

export async function confirm(opts) {
  return inqConfirm({
    ...opts,
    message: styleMessage(opts?.message),
    theme: {
      ...openCodeTheme,
      ...opts.theme,
    },
  });
}

export async function input(opts) {
  return inqInput({
    ...opts,
    message: styleMessage(opts?.message),
    theme: {
      ...openCodeTheme,
      ...opts.theme,
    },
  });
}

