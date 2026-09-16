import { Keypair } from "@solana/web3.js";
import { expect, it, vi } from "vitest";
import { deployKeeperRelease } from "../release-deploy.js";

const image = "registry.fly.io/zkube-solana-devnet-keeper:deployment-01KY50T1AP5RKZ5K5ET0F50W9X";
const environment = () => ({ ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58(), ZKUBE_LAUNCH_DAY_ID: "21000" });

it("keeper_release_deploy_saves_the_image_binding_and_disables_writes_before_deployment", async () => {
  const calls: Array<string | string[]> = [];
  const run = vi.fn(async (args: string[]) => { calls.push(args); return `image: ${image}`; });
  const save = vi.fn(async () => { calls.push("save"); });
  const env = environment();
  const release = await deployKeeperRelease(env, run, save);
  expect(calls).toEqual([
    ["deploy", "--config", "services/fly.keeper.toml", "--build-only", "--push"],
    "save",
    ["secrets", "set", "--config", "services/fly.keeper.toml", "--stage", "KEEPER_WRITE_ENABLED=false"],
    ["deploy", "--config", "services/fly.keeper.toml", "--image", image,
      "--env", `ZKUBE_KEEPER_PUBLIC_KEY=${env.ZKUBE_KEEPER_PUBLIC_KEY}`, "--env", "ZKUBE_LAUNCH_DAY_ID=21000"],
  ]);
  expect(save).toHaveBeenCalledWith(release);
  expect(release.record.keeperImageReference).toBe(image);
});

it("keeper_release_deploy_rejects_missing_inputs_and_ambiguous_build_output", async () => {
  const run = vi.fn(async () => "no image");
  const save = vi.fn();
  await expect(deployKeeperRelease({}, run, save)).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  await expect(deployKeeperRelease(environment(), run, save)).rejects.toThrow("one immutable");
  expect(run).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it("keeper_release_deploy_can_reuse_an_immutable_image_without_rebuilding", async () => {
  const run = vi.fn<(args: string[]) => Promise<string>>().mockResolvedValue("");
  await deployKeeperRelease({ ...environment(), FLY_IMAGE_REF: image }, run, vi.fn());
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls.some(([args]) => args.includes("--build-only"))).toBe(false);
});
