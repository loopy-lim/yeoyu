import { basename, join } from "node:path";
import { existsSync } from "node:fs";

export function validateReleaseInputs(env: Record<string, string | undefined>, mode: "local" | "distribution") {
  if (mode === "local") return { mode, versionCode: 1, versionName: "1.0-local" };
  const required = ["YEORYU_STORE_FILE", "YEORYU_STORE_PASSWORD", "YEORYU_KEY_ALIAS", "YEORYU_KEY_PASSWORD", "YEORYU_VERSION_CODE", "YEORYU_PREVIOUS_VERSION_CODE", "YEORYU_VERSION_NAME"];
  for (const name of required) if (!env[name]?.trim()) throw Error(`Distribution requires ${name}`);
  const versionCode = Number(env.YEORYU_VERSION_CODE);
  const previous = Number(env.YEORYU_PREVIOUS_VERSION_CODE);
  if (!/^[1-9]\d*$/.test(env.YEORYU_VERSION_CODE!) || !/^\d+$/.test(env.YEORYU_PREVIOUS_VERSION_CODE!) ||
      !Number.isSafeInteger(versionCode) || !Number.isSafeInteger(previous) || previous < 0 || versionCode <= previous || versionCode > 2100000000)
    throw Error("Distribution versionCode must be an integer larger than the previous release and at most 2100000000");
  if (env.YEORYU_VERSION_NAME!.length > 64 || /[\s\u0000-\u001f]/.test(env.YEORYU_VERSION_NAME!))
    throw Error("Distribution versionName must be a nonempty version without whitespace");
  if (env.YEORYU_KEY_ALIAS!.toLowerCase() === "androiddebugkey" || basename(env.YEORYU_STORE_FILE!).toLowerCase() === "debug.keystore")
    throw Error("Distribution cannot use Android debug signing");
  return { mode, versionCode, versionName: env.YEORYU_VERSION_NAME! };
}

if (import.meta.main) {
  try {
    const mode = process.argv[2] === "local" ? "local" : "distribution";
    const result = validateReleaseInputs(process.env, mode);
    if (mode === "distribution" && !existsSync(process.env.YEORYU_STORE_FILE!)) throw Error("Distribution keystore file does not exist");
    if (mode === "distribution") {
      const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/keytool") : "keytool";
      const certificate = Bun.spawnSync([keytool, "-J-Duser.language=en", "-list", "-v", "-keystore", process.env.YEORYU_STORE_FILE!, "-storepass:env", "YEORYU_STORE_PASSWORD", "-alias", process.env.YEORYU_KEY_ALIAS!], { stdout: "pipe", stderr: "pipe" });
      if (certificate.exitCode !== 0) throw Error("Distribution signing certificate could not be verified");
      if (/CN\s*=\s*Android Debug/i.test(certificate.stdout.toString())) throw Error("Distribution certificate is an Android debug certificate");
    }
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    // Names only: never print environment contents or signing credentials.
    process.stderr.write((error instanceof Error ? error.message : "Invalid release inputs") + "\n");
    process.exitCode = 1;
  }
}
