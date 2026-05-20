import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Device, PlatformDiscovery } from "../../src/devices/types.js";
import {
  buildDeviceChoices,
  formatDeviceLabel,
  NoSelectableDevices,
  pickDevices,
  resolveSelectedDevices,
  UserCancelled,
} from "../../src/ui/picker.js";

const iosDevice: Device = {
  id: "ios:ABC",
  name: "iPhone 16",
  platform: "ios",
  runtime: "iOS 18.2",
  state: "Shutdown",
  source: "simctl",
  selectable: true,
  udid: "ABC",
};

const unavailableIosDevice: Device = {
  ...iosDevice,
  id: "ios:DEF",
  name: "Old iPhone",
  selectable: false,
  udid: "DEF",
};

const androidDevice: Device = {
  id: "android:Pixel_8",
  name: "Pixel_8",
  platform: "android",
  runtime: "Android AVD",
  state: "Running",
  source: "android-emulator",
  selectable: true,
  avdName: "Pixel_8",
  serial: "emulator-5554",
};

describe("picker helpers", () => {
  it("formats device labels with name, runtime, and state", () => {
    expect(formatDeviceLabel(iosDevice)).toBe("iPhone 16 (iOS 18.2) - Shutdown");
  });

  it("builds grouped choices for platform discoveries", () => {
    const discoveries: PlatformDiscovery[] = [
      {
        platform: "ios",
        available: true,
        devices: [iosDevice, unavailableIosDevice],
      },
      {
        platform: "android",
        available: false,
        devices: [androidDevice],
        message: "Android unavailable: adb not found",
      },
    ];

    expect(buildDeviceChoices(discoveries)).toEqual([
      {
        name: "iOS Simulators",
        value: "header:ios",
        disabled: true,
      },
      {
        name: "iPhone 16 (iOS 18.2) - Shutdown",
        value: "ios:ABC",
        disabled: false,
      },
      {
        name: "Old iPhone (iOS 18.2) - Shutdown",
        value: "ios:DEF",
        disabled: "Unavailable",
      },
      {
        name: "Android Emulators",
        value: "header:android",
        disabled: "Android unavailable: adb not found",
      },
      {
        name: "Pixel_8 (Android AVD) - Running",
        value: "android:Pixel_8",
        disabled: false,
      },
    ]);
  });

  it("resolves only selected real device IDs", () => {
    const discoveries: PlatformDiscovery[] = [
      {
        platform: "ios",
        available: true,
        devices: [iosDevice],
      },
      {
        platform: "android",
        available: true,
        devices: [androidDevice],
      },
    ];

    expect(resolveSelectedDevices(["header:ios", "ios:ABC", "missing", "android:Pixel_8"], discoveries)).toEqual([
      iosDevice,
      androidDevice,
    ]);
  });

  it("throws a clear error when no choices are selectable", async () => {
    await expect(
      pickDevices([
        {
          platform: "ios",
          available: true,
          devices: [unavailableIosDevice],
        },
      ]),
    ).rejects.toBeInstanceOf(NoSelectableDevices);
  });

  it("treats escape as user cancellation", async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const picking = pickDevices([
      {
        platform: "ios",
        available: true,
        devices: [iosDevice],
      },
    ], { input, output });

    setImmediate(() => {
      input.emit("keypress", "", { name: "escape" });
    });

    await expect(picking).rejects.toBeInstanceOf(UserCancelled);
  });
});
