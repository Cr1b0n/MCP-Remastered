import chalk from "chalk";
import ansiEscapes from "ansi-escapes";
import { c, glyph } from "./theme.js";
import { contentIndent } from "./renderer.js";

const P = () => " ".repeat(contentIndent());

// OpenCode Smooth Braille Spinner Frames
const dotSpinFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const bounceFrames = ["   ", ".  ", ".. ", "...", " ..", "  .", "   "];

export function createLoader(opts = {}) {
  const frames = opts.frames === "dots" ? bounceFrames : dotSpinFrames;
  const color = opts.color ?? c.primary;
  let interval = null;
  let frameIndex = 0;
  let currentText = "";
  let running = false;

  function write() {
    const frame = frames[frameIndex % frames.length];
    process.stdout.write(ansiEscapes.cursorTo(0));
    process.stdout.write(ansiEscapes.eraseLine);
    process.stdout.write(`${P()}${color(frame)}  ${c.text(currentText)}`);
    frameIndex++;
  }

  return {
    start(text) {
      currentText = text;
      running = true;
      frameIndex = 0;
      write();
      interval = setInterval(() => {
        if (running) write();
      }, 80);
    },

    text(text) {
      currentText = text;
      if (running) write();
    },

    stop(finalText) {
      running = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write(ansiEscapes.cursorTo(0));
      process.stdout.write(ansiEscapes.eraseLine);
      if (finalText) {
        process.stdout.write(finalText);
      }
    },

    succeed(text) {
      this.stop(`${P()}${c.success(glyph.check)}  ${c.text(text)}\n`);
    },

    fail(text) {
      this.stop(`${P()}${c.error(glyph.cross)}  ${c.text(text)}\n`);
    },

    warn(text) {
      this.stop(`${P()}${c.warning(glyph.warn)}  ${c.text(text)}\n`);
    },
  };
}

export const loader = createLoader;

