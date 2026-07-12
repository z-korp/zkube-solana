/**
 * Development mount for the same stateless paymaster handler used by Vercel.
 * This follows cycling-sim: the browser always calls /api/paymaster, while
 * signer material remains server-only and never enters Vite's client env.
 */
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import {
  createDevnetPaymasterConnection,
  handlePaymasterRequest,
  paymasterKeypairFromEnv,
  type PaymasterDependencies,
} from "./paymaster";

export function paymasterDevPlugin(): Plugin {
  let dependencies: PaymasterDependencies | null = null;
  let bootError = "paymaster is not configured";

  return {
    name: "zkube-paymaster-dev",
    configureServer(server) {
      const env = {
        ...process.env,
        ...loadEnv(server.config.mode, server.config.root, ""),
      };
      try {
        dependencies = {
          keypair: paymasterKeypairFromEnv(env),
          connection: createDevnetPaymasterConnection(env),
          expectedGenesisHash: env.PAYMASTER_GENESIS_HASH,
          telemetry: (event) =>
            process.stdout.write(`${JSON.stringify(event)}\n`),
        };
      } catch (error) {
        bootError = error instanceof Error ? error.message : String(error);
      }

      server.middlewares.use("/api/paymaster", (request, response) => {
        const respond = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };
        if (!dependencies) {
          respond(503, { error: bootError });
          return;
        }
        if (request.method === "GET") {
          void handlePaymasterRequest("GET", null, dependencies)
            .then((result) => respond(result.status, result.body))
            .catch((error) =>
              respond(500, {
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          return;
        }
        let raw = "";
        request.on("data", (chunk: Buffer) => {
          raw += chunk.toString("utf8");
        });
        request.on("end", () => {
          let payload: unknown;
          try {
            payload = JSON.parse(raw);
          } catch {
            respond(400, { error: "invalid JSON" });
            return;
          }
          void handlePaymasterRequest(
            request.method ?? "POST",
            payload,
            dependencies!,
          )
            .then((result) => respond(result.status, result.body))
            .catch((error) =>
              respond(500, {
                error: error instanceof Error ? error.message : String(error),
              }),
            );
        });
      });
    },
  };
}
