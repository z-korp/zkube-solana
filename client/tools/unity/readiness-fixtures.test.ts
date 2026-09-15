import { test,expect,vi } from "vitest";
import { readFileSync,writeFileSync } from "node:fs";
import { generateReadinessFixtures,readinessFixturePath } from "./readiness-fixtures";
test("actual TS session inspection and Daily preconditions produce finite readiness vectors",async()=>{
  const network=vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw new Error("Unexpected network");});
  try{
    const fixture=await generateReadinessFixtures(),text=JSON.stringify(fixture,null,2)+"\n";
    expect(fixture.sessionCases).toHaveLength(8);expect(fixture.dailyCases).toHaveLength(11);
    expect(JSON.stringify(await generateReadinessFixtures(),null,2)+"\n").toBe(text);
    const path=readinessFixturePath;
    if(process.env.ZKUBE_WRITE_UNITY_FIXTURES==="1")writeFileSync(path,text);
    expect(readFileSync(path,"utf8")).toBe(text);expect(network).not.toHaveBeenCalled();
  }finally{network.mockRestore();}
});
