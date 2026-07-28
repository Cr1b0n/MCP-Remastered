import { createDashboard } from "./mcptui/dashboard.js";

export function makeReporter(isRepair) {
  const db = createDashboard();
  let started = false;

  const reporter = (stepId, percent, line) => {
    if (!started) {
      db.start();
      started = true;
    }
    db.update(stepId, percent, line);
  };

  reporter.done = () => {
    db.stop();
  };

  return reporter;
}

export { renderBar } from "./mcptui/dashboard.js";
