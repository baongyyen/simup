import { describe, expect, it } from "vitest";
import { commandExists, CommandError, createNodeCommandRunner } from "../../src/run/command.js";

describe("command runner", () => {
  it("captures stdout, stderr, and nonzero exit codes", async () => {
    const runner = createNodeCommandRunner();

    await expect(
      runner.run(process.execPath, [
        "-e",
        "process.stdout.write('out'); process.stderr.write('err'); process.exit(7);",
      ]),
    ).resolves.toEqual({
      code: 7,
      signal: null,
      stdout: "out",
      stderr: "err",
    });
  });

  it("wraps spawn errors with command context", async () => {
    const runner = createNodeCommandRunner();

    try {
      await runner.run("__opensimu_missing_command__");
      throw new Error("Expected missing command to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect(error).toMatchObject({
        command: "__opensimu_missing_command__",
        args: [],
      });
      expect(String((error as Error).message)).toContain("__opensimu_missing_command__");
    }
  });

  it("rejects on timeout after the child process closes", async () => {
    const runner = createNodeCommandRunner();

    try {
      await runner.run(
        process.execPath,
        [
          "-e",
          "const fs = require('node:fs'); fs.writeSync(1, 'partial-out'); fs.writeSync(2, 'partial-err'); setInterval(() => {}, 1000);",
        ],
        { timeoutMs: 50 },
      );
      throw new Error("Expected timeout to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect(error).toMatchObject({
        command: process.execPath,
        args: [
          "-e",
          "const fs = require('node:fs'); fs.writeSync(1, 'partial-out'); fs.writeSync(2, 'partial-err'); setInterval(() => {}, 1000);",
        ],
        result: {
          code: 143,
          signal: "SIGTERM",
          stdout: "partial-out",
          stderr: "partial-err",
        },
      });
    }
  });

  it("reports signal exits as failures", async () => {
    const runner = createNodeCommandRunner();

    await expect(
      runner.run(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM');"]),
    ).resolves.toMatchObject({
      code: 143,
      signal: "SIGTERM",
    });
  });

  it("reports existing commands", async () => {
    const runner = createNodeCommandRunner();
    await expect(commandExists("node", runner)).resolves.toBe(true);
  });

  it("reports missing commands", async () => {
    const runner = createNodeCommandRunner();
    await expect(commandExists("__opensimu_missing_command__", runner)).resolves.toBe(false);
  });

  it("does not treat shell metacharacters as executable command names", async () => {
    const runner = createNodeCommandRunner();
    await expect(commandExists("node; echo opensimu", runner)).resolves.toBe(false);
  });
});
