import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverAndroidEmulators,
  openAndroidEmulator,
  parseAdbDevices,
  parseAvdList,
} from "../../src/devices/android.js";
import type { AndroidDevice } from "../../src/devices/types.js";
import type { CommandRunner } from "../../src/run/command.js";

const pixel8: AndroidDevice = {
  id: "android:Pixel_8_API_35",
  name: "Pixel_8_API_35",
  platform: "android",
  runtime: "Android AVD",
  state: "Shutdown",
  source: "android-emulator",
  selectable: true,
  avdName: "Pixel_8_API_35",
};

describe("Android devices", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses AVD list output and omits blank lines", () => {
    expect(parseAvdList("\nPixel_8_API_35\n\n  Tablet_API_34  \n")).toEqual([
      "Pixel_8_API_35",
      "Tablet_API_34",
    ]);
  });

  it("parses only running emulator serials from adb devices output", () => {
    expect(
      parseAdbDevices(`List of devices attached
emulator-5554	device
R58N1234	device
emulator-5556	offline
emulator-5558	unauthorized
emulator-5560 device
`),
    ).toEqual(["emulator-5554", "emulator-5560"]);
  });

  it("discovers Android emulators and maps running serials by AVD name", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh" && args.includes("emulator")) {
          return { code: 0, signal: null, stdout: "/opt/android/emulator\n", stderr: "" };
        }
        if (command === "sh" && args.includes("adb")) {
          return { code: 0, signal: null, stdout: "/opt/android/adb\n", stderr: "" };
        }
        if (command === "emulator" && args[0] === "-list-avds") {
          return { code: 0, signal: null, stdout: "Pixel_8_API_35\nTablet_API_34\n", stderr: "" };
        }
        if (command === "adb" && args[0] === "devices") {
          return {
            code: 0,
            signal: null,
            stdout: "List of devices attached\nemulator-5556\tdevice\nR58N1234\tdevice\nemulator-5554\tdevice\n",
            stderr: "",
          };
        }
        if (command === "adb" && args.join(" ") === "-s emulator-5556 emu avd name") {
          return { code: 0, signal: null, stdout: "Tablet_API_34\nOK\n", stderr: "" };
        }
        if (command === "adb" && args.join(" ") === "-s emulator-5554 emu avd name") {
          return { code: 0, signal: null, stdout: "Pixel_8_API_35\nOK\n", stderr: "" };
        }
        return { code: 1, signal: null, stdout: "", stderr: "unexpected command" };
      }),
    };

    await expect(discoverAndroidEmulators(runner)).resolves.toEqual({
      platform: "android",
      available: true,
      devices: [
        {
          id: "android:Pixel_8_API_35",
          name: "Pixel_8_API_35",
          platform: "android",
          runtime: "Android AVD",
          state: "Running",
          source: "android-emulator",
          selectable: true,
          avdName: "Pixel_8_API_35",
          serial: "emulator-5554",
        },
        {
          id: "android:Tablet_API_34",
          name: "Tablet_API_34",
          platform: "android",
          runtime: "Android AVD",
          state: "Running",
          source: "android-emulator",
          selectable: true,
          avdName: "Tablet_API_34",
          serial: "emulator-5556",
        },
      ],
    });
  });

  it("marks Android unavailable when emulator is missing", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh" && args.includes("emulator")) {
          return { code: 1, signal: null, stdout: "", stderr: "" };
        }
        return { code: 0, signal: null, stdout: "/opt/android/adb\n", stderr: "" };
      }),
    };

    await expect(discoverAndroidEmulators(runner)).resolves.toEqual({
      platform: "android",
      available: false,
      devices: [],
      message: "Android unavailable: emulator not found",
    });
  });

  it("marks Android unavailable when adb is missing", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh" && args.includes("adb")) {
          return { code: 1, signal: null, stdout: "", stderr: "" };
        }
        return { code: 0, signal: null, stdout: "/opt/android/emulator\n", stderr: "" };
      }),
    };

    await expect(discoverAndroidEmulators(runner)).resolves.toEqual({
      platform: "android",
      available: false,
      devices: [],
      message: "Android unavailable: adb not found",
    });
  });

  it("starts a stopped AVD and waits for boot completion", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "adb" && args[0] === "devices") {
          return {
            code: 0,
            signal: null,
            stdout: "List of devices attached\nemulator-5554\tdevice\n",
            stderr: "",
          };
        }
        if (command === "adb" && args.join(" ") === "-s emulator-5554 emu avd name") {
          return { code: 0, signal: null, stdout: "Pixel_8_API_35\nOK\n", stderr: "" };
        }
        if (command === "adb" && args.includes("getprop")) {
          return { code: 0, signal: null, stdout: "1\n", stderr: "" };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(openAndroidEmulator(pixel8, runner)).resolves.toEqual({
      ok: true,
      message: "Pixel_8_API_35 is ready",
    });

    expect(runner.run).toHaveBeenNthCalledWith(1, "emulator", ["-avd", "Pixel_8_API_35"], {
      detached: true,
    });
    expect(runner.run).toHaveBeenNthCalledWith(2, "adb", ["devices"], {
      timeoutMs: 180_000,
    });
    expect(runner.run).toHaveBeenNthCalledWith(3, "adb", ["-s", "emulator-5554", "emu", "avd", "name"], {
      timeoutMs: 180_000,
    });
    expect(runner.run).toHaveBeenNthCalledWith(4, "adb", ["-s", "emulator-5554", "wait-for-device"], {
      timeoutMs: 180_000,
    });
    expect(runner.run).toHaveBeenNthCalledWith(
      5,
      "adb",
      ["-s", "emulator-5554", "shell", "getprop", "sys.boot_completed"],
      { timeoutMs: 180_000 },
    );
  });

  it("uses remaining timeout while polling for a launched AVD serial", async () => {
    vi.useFakeTimers();
    let devicesCalls = 0;
    const mappingTimeouts: number[] = [];
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = [], options = {}) => {
        if (command === "adb" && args[0] === "devices") {
          devicesCalls += 1;
          return {
            code: 0,
            signal: null,
            stdout:
              devicesCalls === 1
                ? "List of devices attached\n"
                : "List of devices attached\nemulator-5554\tdevice\n",
            stderr: "",
          };
        }
        if (command === "adb" && args.join(" ") === "-s emulator-5554 emu avd name") {
          mappingTimeouts.push(options.timeoutMs ?? 0);
          return { code: 0, signal: null, stdout: "Pixel_8_API_35\nOK\n", stderr: "" };
        }
        if (command === "adb" && args.includes("getprop")) {
          return { code: 0, signal: null, stdout: "1\n", stderr: "" };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    const opening = openAndroidEmulator(pixel8, runner);
    await vi.advanceTimersByTimeAsync(250);

    await expect(opening).resolves.toEqual({
      ok: true,
      message: "Pixel_8_API_35 is ready",
    });
    expect(mappingTimeouts).toHaveLength(1);
    expect(mappingTimeouts[0]).toBeLessThan(180_000);
  });

  it("does not start an already running AVD", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "adb" && args.includes("getprop")) {
          return { code: 0, signal: null, stdout: "1\n", stderr: "" };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(
      openAndroidEmulator({ ...pixel8, state: "Running", serial: "emulator-5554" }, runner),
    ).resolves.toEqual({
      ok: true,
      message: "Pixel_8_API_35 is ready",
    });

    expect(runner.run).toHaveBeenNthCalledWith(1, "adb", ["-s", "emulator-5554", "wait-for-device"], {
      timeoutMs: 180_000,
    });
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      "adb",
      ["-s", "emulator-5554", "shell", "getprop", "sys.boot_completed"],
      { timeoutMs: 180_000 },
    );
  });

  it("polls until boot completion is reported", async () => {
    let bootChecks = 0;
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "adb" && args.includes("getprop")) {
          bootChecks += 1;
          return {
            code: 0,
            signal: null,
            stdout: bootChecks === 1 ? "0\n" : "1\n",
            stderr: "",
          };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(
      openAndroidEmulator({ ...pixel8, state: "Running", serial: "emulator-5554" }, runner),
    ).resolves.toEqual({
      ok: true,
      message: "Pixel_8_API_35 is ready",
    });
    expect(bootChecks).toBe(2);
  });

  it("returns failure when discovery commands fail", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh") {
          return { code: 0, signal: null, stdout: "/opt/android/tool\n", stderr: "" };
        }
        if (command === "emulator" && args[0] === "-list-avds") {
          return { code: 1, signal: null, stdout: "", stderr: "failed" };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(discoverAndroidEmulators(runner)).resolves.toEqual({
      platform: "android",
      available: false,
      devices: [],
      message: "Android unavailable: emulator or adb failed",
    });
  });

  it("returns failure when adb devices fails during discovery", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh") {
          return { code: 0, signal: null, stdout: "/opt/android/tool\n", stderr: "" };
        }
        if (command === "emulator" && args[0] === "-list-avds") {
          return { code: 0, signal: null, stdout: "Pixel_8_API_35\n", stderr: "" };
        }
        if (command === "adb" && args[0] === "devices") {
          return { code: 1, signal: null, stdout: "", stderr: "failed" };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(discoverAndroidEmulators(runner)).resolves.toEqual({
      platform: "android",
      available: false,
      devices: [],
      message: "Android unavailable: emulator or adb failed",
    });
  });

  it("returns failure when a running emulator cannot be mapped to an AVD name", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh") {
          return { code: 0, signal: null, stdout: "/opt/android/tool\n", stderr: "" };
        }
        if (command === "emulator" && args[0] === "-list-avds") {
          return { code: 0, signal: null, stdout: "Pixel_8_API_35\n", stderr: "" };
        }
        if (command === "adb" && args[0] === "devices") {
          return {
            code: 0,
            signal: null,
            stdout: "List of devices attached\nemulator-5554\tdevice\n",
            stderr: "",
          };
        }
        if (command === "adb" && args.join(" ") === "-s emulator-5554 emu avd name") {
          return { code: 1, signal: null, stdout: "", stderr: "failed" };
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(discoverAndroidEmulators(runner)).resolves.toEqual({
      platform: "android",
      available: false,
      devices: [],
      message: "Android unavailable: emulator or adb failed",
    });
  });

  it("returns failure when waiting for boot rejects", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "adb" && args.join(" ") === "-s emulator-5554 wait-for-device") {
          throw new Error("timed out");
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(
      openAndroidEmulator({ ...pixel8, state: "Running", serial: "emulator-5554" }, runner),
    ).resolves.toEqual({
      ok: false,
      message: "Pixel_8_API_35 failed to boot: timed out",
    });
  });
});
