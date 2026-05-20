import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";

export interface CommandResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
  detached?: boolean;
}

export interface CommandRunner {
  run(command: string, args?: string[], options?: RunOptions): Promise<CommandResult>;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly args: string[],
    readonly result?: CommandResult,
  ) {
    super(message);
  }
}

export function createNodeCommandRunner(): CommandRunner {
  return {
    run(command: string, args: string[] = [], options: RunOptions = {}): Promise<CommandResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          detached: options.detached ?? false,
          stdio: options.detached ? "ignore" : ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;
        let forceKillTimer: NodeJS.Timeout | undefined;

        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          callback();
        };

        const timer =
          options.timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
                forceKillTimer = setTimeout(() => {
                  child.kill("SIGKILL");
                }, 1_000);
              }, options.timeoutMs);

        child.on("error", (error) => {
          finish(() => {
            reject(new CommandError(error.message, command, args));
          });
        });

        if (options.detached) {
          child.on("spawn", () => {
            child.unref();
            finish(() => {
              resolve({ code: 0, signal: null, stdout: "", stderr: "" });
            });
          });
          return;
        }

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("close", (code, signal) => {
          finish(() => {
            const result = {
              code: code ?? signalExitCode(signal),
              signal,
              stdout,
              stderr,
            };

            if (timedOut) {
              reject(
                new CommandError(
                  `Command timed out after ${options.timeoutMs}ms`,
                  command,
                  args,
                  result,
                ),
              );
              return;
            }

            resolve(result);
          });
        });
      });
    },
  };
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) {
    return 1;
  }

  return 128 + (osConstants.signals[signal] ?? 0);
}

export async function commandExists(command: string, runner: CommandRunner): Promise<boolean> {
  try {
    const result = await runner.run("sh", ["-c", "command -v \"$1\"", "opensimu-command-exists", command]);
    return result.code === 0;
  } catch {
    return false;
  }
}
