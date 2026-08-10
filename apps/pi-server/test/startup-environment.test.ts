import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("pi-server startup environment", () => {
  it("consumes loopback access secrets before agent initialization", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/index.ts"), "utf8");
    const consumeAt = source.indexOf("consumeLoopbackAccessEnvironment(process.env)");
    const appLoadAt = source.indexOf('import("./app.js")');
    const agentLoadAt = source.indexOf('import("./agent/scripted-fake-agent.js")');
    const agentAt = source.indexOf("new ScriptedFakeAgentClient()");

    expect(consumeAt).toBeGreaterThan(-1);
    expect(appLoadAt).toBeGreaterThan(consumeAt);
    expect(agentLoadAt).toBeGreaterThan(consumeAt);
    expect(agentAt).toBeGreaterThan(consumeAt);
  });

  it("keeps loopback authorization working without exposing secrets to a real Pi bash child", async () => {
    const securityUrl = pathToFileURL(
      path.resolve(process.cwd(), "src/security/loopback-access.ts")
    ).href;
    const probe = `
      import * as security from ${JSON.stringify(securityUrl)};
      import { createBashTool } from "@earendil-works/pi-coding-agent";

      const policy = security.consumeLoopbackAccessEnvironment(process.env);
      const authorization = security.authorizeLoopbackAccess(
        new Request("http://127.0.0.1/skills", {
          headers: {
            authorization: "Bearer child-secret",
            origin: "http://127.0.0.1:5173"
          }
        }),
        policy
      );
      const tool = createBashTool(process.cwd());
      const result = await tool.execute(
        "env-probe",
        {
          command: "node -e 'process.stdout.write(JSON.stringify({bearer:process.env.MARGINALIA_LOOPBACK_BEARER??null,origin:process.env.MARGINALIA_ALLOWED_ORIGIN??null}))'"
        },
        new AbortController().signal
      );
      const output = result.content.find((part) => part.type === "text")?.text ?? "{}";
      process.stdout.write(JSON.stringify({
        authorization,
        policyBearer: policy.bearer,
        policyOrigins: [...policy.allowedOrigins],
        parentBearer: process.env.MARGINALIA_LOOPBACK_BEARER ?? null,
        parentOrigin: process.env.MARGINALIA_ALLOWED_ORIGIN ?? null,
        toolEnvironment: JSON.parse(output)
      }));
    `;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", probe],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MARGINALIA_LOOPBACK_BEARER: "child-secret",
          MARGINALIA_ALLOWED_ORIGIN: "http://127.0.0.1:5173"
        }
      }
    );

    expect(JSON.parse(stdout)).toEqual({
      authorization: null,
      policyBearer: "child-secret",
      policyOrigins: ["http://127.0.0.1:5173"],
      parentBearer: null,
      parentOrigin: null,
      toolEnvironment: { bearer: null, origin: null }
    });
  }, 15_000);
});
