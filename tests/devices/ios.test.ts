import { describe, expect, it, vi } from "vitest";
import {
  discoverIosSimulators,
  openIosSimulator,
  parseSimctlDevices,
  runtimeName,
} from "../../src/devices/ios.js";
import type { CommandRunner } from "../../src/run/command.js";

const simctlJson = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.tvOS-18-2": [
      {
        udid: "TV-123",
        isAvailable: true,
        state: "Shutdown",
        name: "Apple TV",
      },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
      {
        dataPath: "/tmp/device",
        logPath: "/tmp/log",
        udid: "ABC-123",
        isAvailable: true,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
        state: "Shutdown",
        name: "iPhone 16",
      },
      {
        udid: "DEF-456",
        isAvailable: false,
        state: "Shutdown",
        name: "Old iPhone",
      },
      {
        udid: "GHI-789",
        availabilityError: "runtime profile not found",
        state: "Shutdown",
        name: "Broken iPhone",
      },
    ],
  },
});

describe("iOS devices", () => {
  it.each([
    ["iOS-18-2", "iOS 18.2"],
    ["", ""],
    ["iOS-18-2.", ""],
  ])("formats the last runtime segment of %j", (identifier, name) => {
    expect(runtimeName(identifier)).toBe(name);
  });

  it("parses available simctl devices and omits unavailable devices", () => {
    expect(parseSimctlDevices(simctlJson)).toEqual([
      {
        id: "ios:ABC-123",
        name: "iPhone 16",
        platform: "ios",
        runtime: "iOS 18.2",
        state: "Shutdown",
        source: "simctl",
        selectable: true,
        udid: "ABC-123",
      },
    ]);
  });

  it("marks iOS unavailable when simctl list returns nonzero", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "sh" && args.includes("xcrun")) {
          return { code: 0, signal: null, stdout: "/usr/bin/xcrun\n", stderr: "" };
        }
        return { code: 1, signal: null, stdout: "", stderr: "simctl failed" };
      }),
    };

    await expect(discoverIosSimulators(runner)).resolves.toEqual({
      platform: "ios",
      available: false,
      devices: [],
      message: "iOS unavailable: xcrun not found or simctl failed",
    });
  });

  it("marks iOS unavailable when xcrun is missing or simctl fails", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async () => {
        throw new Error("missing");
      }),
    };

    await expect(discoverIosSimulators(runner)).resolves.toEqual({
      platform: "ios",
      available: false,
      devices: [],
      message: "iOS unavailable: xcrun not found or simctl failed",
    });
  });

  it("boots shutdown simulator, opens Simulator.app, and waits for bootstatus", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async () => ({ code: 0, signal: null, stdout: "", stderr: "" })),
    };

    await expect(
      openIosSimulator(
        {
          id: "ios:ABC-123",
          name: "iPhone 16",
          platform: "ios",
          runtime: "iOS 18.2",
          state: "Shutdown",
          source: "simctl",
          selectable: true,
          udid: "ABC-123",
        },
        runner,
      ),
    ).resolves.toEqual({
      ok: true,
      message: "iPhone 16 is ready",
    });

    expect(runner.run).toHaveBeenNthCalledWith(1, "xcrun", ["simctl", "boot", "ABC-123"]);
    expect(runner.run).toHaveBeenNthCalledWith(2, "open", ["-a", "Simulator"]);
    expect(runner.run).toHaveBeenNthCalledWith(
      3,
      "xcrun",
      ["simctl", "bootstatus", "ABC-123", "-b"],
      { timeoutMs: 120_000 },
    );
  });

  it("does not boot an already booted simulator", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async () => ({ code: 0, signal: null, stdout: "", stderr: "" })),
    };

    await expect(
      openIosSimulator(
        {
          id: "ios:ABC-123",
          name: "iPhone 16",
          platform: "ios",
          runtime: "iOS 18.2",
          state: "Booted",
          source: "simctl",
          selectable: true,
          udid: "ABC-123",
        },
        runner,
      ),
    ).resolves.toEqual({
      ok: true,
      message: "iPhone 16 is ready",
    });

    expect(runner.run).toHaveBeenNthCalledWith(1, "open", ["-a", "Simulator"]);
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      "xcrun",
      ["simctl", "bootstatus", "ABC-123", "-b"],
      { timeoutMs: 120_000 },
    );
  });

  it("returns failure when bootstatus rejects", async () => {
    const runner: CommandRunner = {
      run: vi.fn(async (command, args = []) => {
        if (command === "xcrun" && args.includes("bootstatus")) {
          throw new Error("timed out");
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }),
    };

    await expect(
      openIosSimulator(
        {
          id: "ios:ABC-123",
          name: "iPhone 16",
          platform: "ios",
          runtime: "iOS 18.2",
          state: "Shutdown",
          source: "simctl",
          selectable: true,
          udid: "ABC-123",
        },
        runner,
      ),
    ).resolves.toEqual({
      ok: false,
      message: "iPhone 16 failed to boot: timed out",
    });
  });
});
