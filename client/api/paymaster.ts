import {
  createDevnetPaymasterConnection,
  handlePaymasterRequest,
  paymasterKeypairFromEnv,
} from "../src/server/paymaster.js";

interface RequestLike {
  method?: string;
  body?: unknown;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  try {
    const result = await handlePaymasterRequest(
      request.method ?? "GET",
      request.body,
      {
        keypair: paymasterKeypairFromEnv(),
        connection: createDevnetPaymasterConnection(),
        expectedGenesisHash: process.env.PAYMASTER_GENESIS_HASH,
        telemetry: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
      },
    );
    response.status(result.status).json(result.body);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "paymaster initialization failed",
    });
  }
}
