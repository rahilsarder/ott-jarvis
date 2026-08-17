export interface DeployInvocation {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface DeploymentForDeploy {
  sshHost: string;
  sshUser: string;
  baseUrl: string;
  brandName: string;
  adminEmail: string;
  flussonicBaseUrl: string;
  flussonicSecurelinkKey: string;
}

export function buildDeployInvocation(deployment: DeploymentForDeploy): DeployInvocation {
  const hostName = deployment.baseUrl.replace(/^https?:\/\//, '');
  return {
    command: 'ops/deploy.sh',
    args: [`${deployment.sshUser}@${deployment.sshHost}`, '--non-interactive'],
    env: {
      DEPLOY_PROTOCOL: 'http',
      DEPLOY_HOST_NAME: hostName,
      DEPLOY_BRAND_NAME: deployment.brandName,
      DEPLOY_ADMIN_EMAIL: deployment.adminEmail,
      DEPLOY_FLUSSONIC_BASE_URL: deployment.flussonicBaseUrl,
      DEPLOY_FLUSSONIC_SECURELINK_KEY: deployment.flussonicSecurelinkKey,
    },
  };
}

export function parseAdminPassword(logText: string): string | null {
  const match = logText.match(/Admin password:\s+(\S+)/);
  return match ? match[1] : null;
}
