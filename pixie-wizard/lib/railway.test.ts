import { test, expect, afterEach } from "bun:test";
import {
  RailwayApiError,
  createProjectAndService,
  createVolume,
  setVariables,
  triggerDeploy,
  latestDeploymentStatus,
  isTerminalDeploymentStatus,
  pauseService,
  resumeService,
  deleteProject,
} from "./railway";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

function mockSequence(responses: unknown[]) {
  let i = 0;
  const calls: Array<{ query: string; variables: unknown }> = [];
  global.fetch = (async (_url: unknown, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return jsonResponse(body);
  }) as unknown as typeof fetch;
  return calls;
}

test("createProjectAndService chains projectCreate then serviceCreate and returns all three ids", async () => {
  const calls = mockSequence([
    { data: { projectCreate: { id: "proj1", baseEnvironmentId: "env1" } } },
    { data: { serviceCreate: { id: "svc1" } } },
  ]);

  const result = await createProjectAndService("token", "athena-trial");

  expect(result).toEqual({ projectId: "proj1", environmentId: "env1", serviceId: "svc1" });
  expect(calls).toHaveLength(2);
  expect(calls[0].query).toMatch(/projectCreate/);
  expect(calls[1].query).toMatch(/serviceCreate/);
  expect((calls[1].variables as any).input.projectId).toBe("proj1");
  expect((calls[1].variables as any).input.environmentId).toBe("env1");
  expect((calls[1].variables as any).input.source.repo).toBe("rickyparmar-raw/PIXIE");
});

test("a Railway GraphQL error response throws RailwayApiError instead of returning undefined", async () => {
  mockSequence([{ errors: [{ message: "Not Authorized" }] }]);
  await expect(createProjectAndService("token", "x")).rejects.toThrow(RailwayApiError);
});

test("setVariables sends skipDeploys true so variables land before any redeploy", async () => {
  const calls = mockSequence([{ data: { variableCollectionUpsert: true } }]);
  await setVariables(
    "token",
    { projectId: "p", environmentId: "e", serviceId: "s" },
    { SLACK_BOT_TOKEN: "xoxb-x" },
  );
  const input = (calls[0].variables as any).input;
  expect(input.skipDeploys).toBe(true);
  expect(input.variables.SLACK_BOT_TOKEN).toBe("xoxb-x");
});

test("triggerDeploy hits environmentTriggersDeploy with the target's ids", async () => {
  const calls = mockSequence([{ data: { environmentTriggersDeploy: true } }]);
  await triggerDeploy("token", { projectId: "p", environmentId: "e", serviceId: "s" });
  expect(calls[0].query).toMatch(/environmentTriggersDeploy/);
});

test("latestDeploymentStatus returns null when there are no deployments yet", async () => {
  mockSequence([{ data: { deployments: { edges: [] } } }]);
  const status = await latestDeploymentStatus("token", { projectId: "p", environmentId: "e", serviceId: "s" });
  expect(status).toBeNull();
});

test("latestDeploymentStatus returns the newest deployment's id and status", async () => {
  mockSequence([{ data: { deployments: { edges: [{ node: { id: "dep1", status: "BUILDING" } }] } } }]);
  const status = await latestDeploymentStatus("token", { projectId: "p", environmentId: "e", serviceId: "s" });
  expect(status).toEqual({ id: "dep1", status: "BUILDING" });
});

test("isTerminalDeploymentStatus is true only for statuses that end polling", () => {
  expect(isTerminalDeploymentStatus("SUCCESS")).toBe(true);
  expect(isTerminalDeploymentStatus("FAILED")).toBe(true);
  expect(isTerminalDeploymentStatus("CRASHED")).toBe(true);
  expect(isTerminalDeploymentStatus("BUILDING")).toBe(false);
  expect(isTerminalDeploymentStatus("QUEUED")).toBe(false);
});

test("pauseService sets sleepApplication true and does not itself trigger a deploy", async () => {
  const calls = mockSequence([{ data: { serviceInstanceUpdate: true } }]);
  await pauseService("token", { projectId: "p", environmentId: "e", serviceId: "s" });
  expect(calls).toHaveLength(1);
  expect((calls[0].variables as any).input.sleepApplication).toBe(true);
});

test("resumeService sets sleepApplication false and explicitly triggers a deploy after", async () => {
  const calls = mockSequence([
    { data: { serviceInstanceUpdate: true } },
    { data: { environmentTriggersDeploy: true } },
  ]);
  await resumeService("token", { projectId: "p", environmentId: "e", serviceId: "s" });
  expect(calls).toHaveLength(2);
  expect((calls[0].variables as any).input.sleepApplication).toBe(false);
  expect(calls[1].query).toMatch(/environmentTriggersDeploy/);
});

test("deleteProject calls projectDelete with the given id", async () => {
  const calls = mockSequence([{ data: { projectDelete: true } }]);
  await deleteProject("token", "proj-to-kill");
  expect((calls[0].variables as any).id).toBe("proj-to-kill");
});

test("createVolume mounts at the given path and returns the volume id", async () => {
  const calls = mockSequence([{ data: { volumeCreate: { id: "vol1" } } }]);
  const id = await createVolume("token", { projectId: "p", environmentId: "e", serviceId: "s" }, "/data");

  expect(id).toBe("vol1");
  expect(calls[0].query).toMatch(/volumeCreate/);
  expect((calls[0].variables as any).input.mountPath).toBe("/data");
});

// VolumeCreateInput doesn't mark environmentId required, but omitting it makes
// Railway report success while creating a volume that attaches to nothing.
test("createVolume always sends environmentId, which Railway silently needs", async () => {
  const calls = mockSequence([{ data: { volumeCreate: { id: "vol1" } } }]);
  await createVolume("token", { projectId: "p", environmentId: "e", serviceId: "s" }, "/data");

  const input = (calls[0].variables as any).input;
  expect(input.environmentId).toBe("e");
  expect(input.projectId).toBe("p");
  expect(input.serviceId).toBe("s");
});
