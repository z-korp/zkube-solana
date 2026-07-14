import { handleKeeperRequest } from "../src/server/keeper.js";

interface RequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  const result = await handleKeeperRequest(request);
  response.status(result.status).json(result.body);
}
