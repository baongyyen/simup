import { describe, expect, it, vi } from "vitest";
import { openDevices } from "../../src/open/openDevices.js";
import type { Device } from "../../src/devices/types.js";

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

const androidDevice: Device = {
  id: "android:Pixel_8",
  name: "Pixel_8",
  platform: "android",
  runtime: "Android AVD",
  state: "Shutdown",
  source: "android-emulator",
  selectable: true,
  avdName: "Pixel_8",
};

const androidTablet: Device = {
  ...androidDevice,
  id: "android:Tablet",
  name: "Tablet",
  avdName: "Tablet",
};

describe("openDevices", () => {
  it("opens all selected devices and returns success", async () => {
    const opener = vi.fn(async (device: Device) => ({
      device,
      ok: true,
      message: `${device.name} ready`,
    }));

    await expect(openDevices([iosDevice, androidDevice], opener)).resolves.toEqual({
      ok: true,
      results: [
        { device: iosDevice, ok: true, message: "iPhone 16 ready" },
        { device: androidDevice, ok: true, message: "Pixel_8 ready" },
      ],
    });
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it("keeps opening other devices when one fails", async () => {
    const opener = vi.fn(async (device: Device) => ({
      device,
      ok: device.platform !== "android",
      message: device.platform === "android" ? "Pixel_8 failed" : "iPhone 16 ready",
    }));

    await expect(openDevices([iosDevice, androidDevice], opener)).resolves.toEqual({
      ok: false,
      results: [
        { device: iosDevice, ok: true, message: "iPhone 16 ready" },
        { device: androidDevice, ok: false, message: "Pixel_8 failed" },
      ],
    });
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it("converts thrown opener errors into failed results and keeps opening", async () => {
    const opener = vi.fn(async (device: Device) => {
      if (device === androidDevice) {
        throw new Error("emulator rejected launch");
      }

      return {
        device,
        ok: true,
        message: `${device.name} ready`,
      };
    });

    await expect(openDevices([iosDevice, androidDevice, androidTablet], opener)).resolves.toEqual({
      ok: false,
      results: [
        { device: iosDevice, ok: true, message: "iPhone 16 ready" },
        { device: androidDevice, ok: false, message: "emulator rejected launch" },
        { device: androidTablet, ok: true, message: "Tablet ready" },
      ],
    });
    expect(opener).toHaveBeenCalledTimes(3);
  });

  it("preserves input order while respecting the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const releaseById = new Map<string, () => void>();
    const starts: string[] = [];
    const opener = vi.fn(async (device: Device) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      starts.push(device.id);

      await new Promise<void>((resolve) => {
        releaseById.set(device.id, resolve);
      });

      active -= 1;
      return {
        device,
        ok: true,
        message: `${device.name} ready`,
      };
    });

    const summaryPromise = openDevices([iosDevice, androidDevice, androidTablet], opener, 2);
    await vi.waitFor(() => expect(starts).toEqual(["ios:ABC", "android:Pixel_8"]));

    releaseById.get("android:Pixel_8")?.();
    await vi.waitFor(() =>
      expect(starts).toEqual(["ios:ABC", "android:Pixel_8", "android:Tablet"]),
    );

    releaseById.get("android:Tablet")?.();
    releaseById.get("ios:ABC")?.();

    await expect(summaryPromise).resolves.toEqual({
      ok: true,
      results: [
        { device: iosDevice, ok: true, message: "iPhone 16 ready" },
        { device: androidDevice, ok: true, message: "Pixel_8 ready" },
        { device: androidTablet, ok: true, message: "Tablet ready" },
      ],
    });
    expect(maxActive).toBe(2);
  });

  it("returns success immediately for empty device lists", async () => {
    const opener = vi.fn();

    await expect(openDevices([], opener)).resolves.toEqual({ ok: true, results: [] });
    expect(opener).not.toHaveBeenCalled();
  });
});
