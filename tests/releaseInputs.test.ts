import { expect, test } from "bun:test";
import { validateReleaseInputs } from "../scripts/validate-release";

const valid = () => ({
  YEORYU_STORE_FILE: "/tmp/distribution.keystore", YEORYU_STORE_PASSWORD: "test-only",
  YEORYU_KEY_ALIAS: "distribution", YEORYU_KEY_PASSWORD: "test-only",
  YEORYU_VERSION_CODE: "2", YEORYU_PREVIOUS_VERSION_CODE: "1", YEORYU_VERSION_NAME: "1.1.0",
});
test("distribution refuses missing or partial signing and non-increasing versions", () => {
  for (const missing of Object.keys(valid())) {
    const input: Record<string, string> = valid(); delete input[missing];
    expect(() => validateReleaseInputs(input, "distribution")).toThrow();
  }
  for (const code of ["0", "1", "-1", "2.5", "2100000001"])
    expect(() => validateReleaseInputs({ ...valid(), YEORYU_VERSION_CODE: code }, "distribution")).toThrow();
  expect(validateReleaseInputs(valid(), "distribution")).toEqual({ mode: "distribution", versionCode: 2, versionName: "1.1.0" });
});
test("distribution cannot use the Android debug signing identity", () => {
  expect(() => validateReleaseInputs({ ...valid(), YEORYU_KEY_ALIAS: "androiddebugkey" }, "distribution")).toThrow();
  expect(() => validateReleaseInputs({ ...valid(), YEORYU_STORE_FILE: "/tmp/debug.keystore" }, "distribution")).toThrow();
});
test("local test builds are explicitly labeled and require no distribution credentials", () => {
  expect(validateReleaseInputs({}, "local")).toEqual({ mode: "local", versionCode: 1, versionName: "1.0-local" });
});
