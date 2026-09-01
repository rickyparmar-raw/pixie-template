// Railway's GraphQL API client for provisioning trial bots. Mutation names,
// input shapes, and return shapes below were confirmed live via Railway's
// public schema introspection (no auth required for introspection itself) —
// this is the plan's "research spike," not assembled from docs/community
// sources like the rest of the plan assumed it would have to be.
//
// One open question introspection can't answer: sleepApplication (used for
// pauseService below) is Railway's own scale-to-zero primitive, and the
// natural fit for "pause a trial without deleting it." But it's designed
// around HTTP traffic waking the service back up — pixie has no inbound HTTP
// server (Socket Mode), so a slept trial will NOT wake itself back up. That's
// fine for this use case (unpausing is always an explicit owner action, never
// something that should happen silently), but it means resumeService must
// always be called explicitly — never assume sleep alone is reversible on its
// own. Whether sleeping actually stops billing is still unconfirmed without a
// real account-scoped token and a live test; treat that as still open.

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

// apps/pixie is its own standalone GitHub repo, not a subdirectory of the
// Pixl monorepo — confirmed via `git remote -v` inside apps/pixie. No
// rootDirectory setting is needed on the service because of that.
export const PIXIE_REPO_FULL_NAME = "rickyparmar-raw/PIXIE";
export const PIXIE_REPO_BRANCH = "main";

export class RailwayApiError extends Error {
  constructor(
    message: string,
    public readonly errors: unknown,
  ) {
    super(message);
    this.name = "RailwayApiError";
  }
}

async function call<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "pixie-wizard",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new RailwayApiError(json.errors[0].message, json.errors);
  }
  return json.data as T;
}

export interface ProvisionedService {
  projectId: string;
  environmentId: string;
  serviceId: string;
}

export async function createProjectAndService(
  token: string,
  name: string,
): Promise<ProvisionedService> {
  const projectResult = await call<{ projectCreate: { id: string; baseEnvironmentId: string } }>(
    token,
    `mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) { id baseEnvironmentId }
    }`,
    { input: { name, defaultEnvironmentName: "production" } },
  );
  const projectId = projectResult.projectCreate.id;
  const environmentId = projectResult.projectCreate.baseEnvironmentId;

  const serviceResult = await call<{ serviceCreate: { id: string } }>(
    token,
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id }
    }`,
    {
      input: {
        projectId,
        environmentId,
        name,
        branch: PIXIE_REPO_BRANCH,
        source: { repo: PIXIE_REPO_FULL_NAME },
      },
    },
  );

  return { projectId, environmentId, serviceId: serviceResult.serviceCreate.id };
}

// skipDeploys: true — write every variable first, then trigger exactly one
// deploy explicitly (triggerDeploy below), rather than one partial redeploy
// per variable as they're set.
export async function setVariables(
  token: string,
  target: ProvisionedService,
  variables: Record<string, string>,
): Promise<void> {
  await call<{ variableCollectionUpsert: boolean }>(
    token,
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: target.projectId,
        environmentId: target.environmentId,
        serviceId: target.serviceId,
        variables,
        skipDeploys: true,
      },
    },
  );
}

export async function triggerDeploy(token: string, target: ProvisionedService): Promise<void> {
  await call<{ environmentTriggersDeploy: boolean }>(
    token,
    `mutation($input: EnvironmentTriggersDeployInput!) {
      environmentTriggersDeploy(input: $input)
    }`,
    {
      input: {
        projectId: target.projectId,
        environmentId: target.environmentId,
        serviceId: target.serviceId,
      },
    },
  );
}

// Persistent storage for the bot's SQLite file. Without it the database sits in
// the container filesystem and every redeploy discards it — and since every bot
// tracks main with auto-deploy, "every redeploy" means every push. What's lost is
// the answer cache, the learned/taught facts, ticket records and the last-good
// docs copy that keeps the bot answering through a GitHub rate limit.
//
// environmentId is NOT marked required in VolumeCreateInput, but leaving it out
// makes the mutation return success while creating a volume that never attaches
// to anything — a silent no-op. It is always passed here for that reason.
//
// Must be called before the first triggerDeploy: the engine opens the database on
// boot, so a volume attached afterwards means the first run wrote somewhere that
// then vanished.
export async function createVolume(
  token: string,
  target: ProvisionedService,
  mountPath: string,
): Promise<string> {
  const result = await call<{ volumeCreate: { id: string } }>(
    token,
    `mutation($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id }
    }`,
    {
      input: {
        projectId: target.projectId,
        environmentId: target.environmentId,
        serviceId: target.serviceId,
        mountPath,
      },
    },
  );
  return result.volumeCreate.id;
}

export type DeploymentStatus =
  | "BUILDING"
  | "CRASHED"
  | "DEPLOYING"
  | "FAILED"
  | "INITIALIZING"
  | "NEEDS_APPROVAL"
  | "QUEUED"
  | "REMOVED"
  | "REMOVING"
  | "SKIPPED"
  | "SLEEPING"
  | "SUCCESS"
  | "WAITING";

const TERMINAL_STATUSES = new Set<DeploymentStatus>(["SUCCESS", "FAILED", "CRASHED", "REMOVED"]);

export async function latestDeploymentStatus(
  token: string,
  target: ProvisionedService,
): Promise<{ id: string; status: DeploymentStatus } | null> {
  const result = await call<{
    deployments: { edges: Array<{ node: { id: string; status: DeploymentStatus } }> };
  }>(
    token,
    `query($input: DeploymentListInput!) {
      deployments(input: $input, first: 1) { edges { node { id status } } }
    }`,
    {
      input: {
        projectId: target.projectId,
        environmentId: target.environmentId,
        serviceId: target.serviceId,
      },
    },
  );
  return result.deployments.edges[0]?.node ?? null;
}

export function isTerminalDeploymentStatus(status: DeploymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// See the module-level note: this stops the service but will not wake itself
// back up without inbound HTTP traffic. Always pair with an explicit
// resumeService call, never rely on Railway to reverse it automatically.
export async function pauseService(token: string, target: ProvisionedService): Promise<void> {
  await call<{ serviceInstanceUpdate: boolean }>(
    token,
    `mutation($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    { serviceId: target.serviceId, environmentId: target.environmentId, input: { sleepApplication: true } },
  );
}

export async function resumeService(token: string, target: ProvisionedService): Promise<void> {
  await call<{ serviceInstanceUpdate: boolean }>(
    token,
    `mutation($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    { serviceId: target.serviceId, environmentId: target.environmentId, input: { sleepApplication: false } },
  );
  await triggerDeploy(token, target);
}

export async function deleteProject(token: string, projectId: string): Promise<void> {
  await call<{ projectDelete: boolean }>(
    token,
    `mutation($id: String!) { projectDelete(id: $id) }`,
    { id: projectId },
  );
}
