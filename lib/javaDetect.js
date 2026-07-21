import fs from "fs-extra";
import path from "path";
import { execa } from "execa";

export async function detectJavaInstallations() {
  const found = [];

  const defaultJava = await testJavaBin("java");
  if (defaultJava) found.push(defaultJava);

  const jvmDirs = [
    "/usr/lib/jvm",
    "/usr/lib64/jvm",
    "/usr/java",
    "/opt/java",
    "/opt/jdk",
    "/Library/Java/JavaVirtualMachines",
  ];

  for (const dir of jvmDirs) {
    if (!(await fs.pathExists(dir))) continue;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const javaBin = path.join(dir, entry.name, "bin", "java");
      const javacBin = path.join(dir, entry.name, "bin", "javac");
      if (await fs.pathExists(javaBin) && await fs.pathExists(javacBin)) {
        const info = await testJavaBin(javaBin);
        if (info) found.push(info);
      }
    }
  }

  const seen = new Set();
  return found.filter(j => {
    const key = j.major;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.major - a.major);
}

export async function testJavaBin(javaBin) {
  try {
    const { stdout, stderr } = await execa(javaBin, ["-version"]);
    const txt = `${stdout} ${stderr}`;
    const m = txt.match(/(\d+)\.(\d+)\.(\d+)/) || txt.match(/(\d+)\.(\d+)/);
    const v = m ? parseInt(m[1], 10) : 0;
    const major = v >= 17 ? v : (m ? parseInt(m[2], 10) : 0);
    const vendor = txt.includes("OpenJDK") ? "OpenJDK" : txt.includes("Oracle") ? "Oracle" : "Unknown";
    const arch = txt.match(/(\d+-bit)/)?.[1] || "";
    return { java: javaBin, javac: javaBin.replace(/\/java$/, "/javac"), major, vendor, arch, version: txt.split("\n")[0]?.trim() || "" };
  } catch {
    return null;
  }
}

export function suggestJavaForVersion(targetMajor, installations) {
  if (!installations || installations.length === 0) return null;
  const exact = installations.find(j => j.major === targetMajor);
  if (exact) return exact;
  const higher = installations.filter(j => j.major >= targetMajor).sort((a, b) => a.major - b.major);
  if (higher.length > 0) return higher[0];
  return installations[0];
}
