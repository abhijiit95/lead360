# LeadFlow360 AWS deployment templates

These are configuration templates only. They have not been deployed or validated against an AWS account. Replace angle-bracket placeholders and supply real parameters through a controlled deployment process; never commit account-specific values or secrets.

## Target topology

```text
Browser --HTTPS--> CloudFront --> private S3 bucket (React/Vite static files)
Browser --HTTPS--> public ALB --> private ECS Fargate API task (4000)
                                        |-- RDS PostgreSQL (private)
                                        |-- managed Redis-compatible service (private)
                                        `-- Google OAuth/OIDC endpoints via controlled outbound egress
                                   private ECS Fargate worker task
                                        |-- RDS PostgreSQL
                                        `-- managed Redis-compatible service
GitHub Actions --OIDC--> API-only ECR publish role --> lead360-api repository
GitHub Actions --OIDC--> separate static-frontend deploy role --> S3 + CloudFront
ECS task execution roles --> ECR image pulls, CloudWatch logs, Secrets Manager reads
```

Start with one API task and one worker task. `networking.yaml` creates two public subnets and two private subnets across the first two AZs in the selected region. The staging template uses one NAT gateway to reduce idle cost; this is a single-AZ egress dependency and should be changed to one NAT gateway per AZ for a production availability target. Place the ALB in public subnets and API, worker, RDS, and Redis in private subnets. API ingress on TCP 4000 is allowed only from the ALB security group. PostgreSQL 5432 and Redis 6379 ingress is allowed only from API, worker, and (for PostgreSQL) the one-off DB-init task security groups. Egress is limited to ALB→API TCP 4000, app→PostgreSQL TCP 5432, app→Valkey TCP 6379, and task TCP 443 egress for AWS service access and Google OAuth/OIDC. RDS and Valkey have no client-initiated egress. The worker has no inbound listener. Do not publish database/cache ports publicly.

Private task subnets route outbound through NAT so Fargate can retrieve ECR images and image layers, read Secrets Manager values, write CloudWatch logs, and reach Google OAuth/OIDC endpoints over HTTPS. This template uses NAT rather than VPC endpoints to avoid endpoint hourly charges in an initial staging stack. A production design can use ECR API/Docker, S3, Secrets Manager, and CloudWatch Logs VPC endpoints and retain controlled NAT/proxy egress for Google. Review endpoint security groups, private DNS, and task execution-role permissions together.

The API currently uses the default in-memory Socket.IO adapter. One API task avoids cross-task event propagation, but scaling beyond one requires a supported shared adapter and a load-balancer transport plan. Do not assume the existing Redis cache or BullMQ connections provide Socket.IO event sharing.

## Templates

- `templates/ecr-repositories.yaml` creates encrypted, scan-on-push, immutable `lead360-api` and `lead360-frontend` ECR repositories and outputs each URI and ARN. Publish full Git SHA tags only. Each expires untagged images after 14 days and retains the 30 most recently pushed tagged images.
- `templates/iam-roles.yaml` separates API, worker, and DB-init execution roles from three no-permission application task roles. Those execution roles pull the same API image and have narrowly scoped log/secret access. The template creates the GitHub OIDC frontend-deployment role, but deliberately does not create a second ECR publishing role. The existing external ECR role is `arn:aws:iam::531767454878:role/GitHubActionsECRPushRole`; the automatic workflow assumes this role directly, and the manual workflow's `AWS_ECR_PUBLISH_ROLE_ARN` variable must point to the same role. Verify that role's live trust and ECR policy in AWS; the template does not manage it. The frontend role trusts an exact repository/environment subject, with the `staging` environment's branch protection providing the branch restriction. Supply exact ECR, log group, bucket, distribution, and secret ARNs. Add narrowly scoped `kms:Decrypt` to execution roles only if referenced secrets use a customer-managed KMS key.
- `templates/github-ssm-deploy-role.yaml` defines a dedicated GitHub OIDC role for SSM Run Command against one EC2 instance. It is separate from the image publisher and static frontend roles.
- `templates/ecs-task-definitions.yaml` defines API, worker, and one-off initializer Fargate tasks. The initial 512 CPU / 1024 MiB settings are valid Fargate sizing examples, not load-tested recommendations. The API command comes from the backend image (`node dist/server.js`); worker uses `node dist/worker.js`; DB initialization runs `npm run db:init` in `/app/backend`. API checks `/api/health/ready`; worker checks its Redis-dependent heartbeat. API and worker have a 120-second stop timeout for graceful shutdown.
- `templates/networking.yaml` creates the VPC, two-AZ subnet layout, staging NAT, and least-privilege ingress and egress security groups. CIDRs must be selected to avoid overlap with connected networks.
- `templates/data-services.yaml` creates private, encrypted RDS PostgreSQL and TLS/auth-enabled ElastiCache Valkey. It expects a Secrets Manager PostgreSQL password and Valkey auth token. The initial Redis configuration is single-node/no-failover and the database defaults to single-AZ; adjust both before production availability commitments.
- `templates/ecs-cluster.yaml` creates the ECS cluster with the existing Container Insights setting. Its `EcsClusterArn` output is the required `ClusterArn` input for `ecs-services-alb.yaml`.
- `templates/ecs-services-alb.yaml` creates the public ALB with HTTP-to-HTTPS redirect, HTTPS listener, readiness target group, and private API/worker Fargate services. It consumes the cluster ARN from `ecs-cluster.yaml`, task-definition ARNs, and network outputs. Configure DNS to alias the API domain to the ALB output.
- `templates/frontend-cloudfront.yaml` defines a private, encrypted S3 bucket, CloudFront Origin Access Control, HTTPS-only distribution, and SPA route fallback. It does not upload the Vite build. CloudFront ACM certificates must be in `us-east-1`; choose a real domain and certificate before deploying.

Run `cfn-lint infra/aws/templates/*.yaml` before provisioning. CloudFormation-aware validation checks template/resource schemas locally; it does not validate live-account IAM, quotas, service availability, or replace review of a CloudFormation change set. No AWS validation or deployment has been performed in this review. Before provisioning, review stack parameters, IAM, CIDR overlap, service quotas/region support, certificate/domain ownership, and resource replacement/deletion behavior. The DB-init task definition is configured in the task-definition template and uses the DB-init security group when run as a one-off Fargate task.

## ECR image convention and GitHub OIDC

The backend/worker image is `lead360-api`; the frontend image is `lead360-frontend`. Both ECR images use the full Git commit SHA as the immutable tag:

```text
<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/lead360-api:<GIT_SHA>
<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/lead360-frontend:<GIT_SHA>
```

`templates/ecr-repositories.yaml` defines both encrypted, immutable repositories. Apply it only through the approved AWS change process; no repository was created or changed as part of local workflow work. The automatic backend ECR publish job runs after CI on pushes to `main`. Frontend ECR publishing is separately disabled by default and runs only when repository variable `ECR_FRONTEND_PUBLISH_ENABLED=true`; set it only after `lead360-frontend` exists and the publisher role policy has been verified. It pushes only the exact commit SHA tag (not `latest`). The workflow job is part of the CI run, so a successful completed CI run includes successful publication of both ECR images when that gate is enabled.

Attach the least-privilege statements in `policies/github-ecr-publisher.json` to the existing GitHub OIDC image-publishing role, `GitHubActionsECRPushRole`, after reviewing its trust policy. The policy permits ECR login and image-push operations only for `lead360-api` and `lead360-frontend`; it does not permit repository creation or policy changes. ECR requires `GetAuthorizationToken` on `*`; image layer and manifest push permissions can be restricted to the target repository ARNs. See the [ECR push IAM guidance](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html).

The existing EC2 instance profile role `lead360-ec2-ecr-role` must also be allowed to pull from both repositories. `policies/lead360-ec2-ecr-pull.json` documents the required login and pull-only permissions. Attach/verify it through the approved AWS change process; this repository update does not alter the instance role. Do not enable deployment if the instance role cannot pull both SHA-tagged images.

## EC2 Docker deployment through SSM

`.github/workflows/deploy-ec2-ssm.yml` waits for the `CI` workflow to complete for a `main` push, then verifies that `build-and-test`, `publish-backend-to-ecr`, and `publish-frontend-to-ecr` all succeeded for the same full Git SHA. It can also be manually dispatched on `main` with a full SHA and explicit confirmation; manual dispatch performs the same successful-CI and image-publishing checks. It assumes a dedicated AWS role through GitHub OIDC and uses SSM `AWS-RunShellScript`; it does not use long-lived AWS access keys.

Deployment is gated off by default. Configure these GitHub **repository variables**:

| Variable | Value/purpose |
| --- | --- |
| `AWS_REGION` | `us-east-1` |
| `EC2_INSTANCE_ID` | `i-08b344c2c5a9f02b8` |
| `AWS_SSM_DEPLOY_ROLE_ARN` | `GitHubEc2DeployRoleArn` output from `github-ssm-deploy-role.yaml`, after the role is provisioned and reviewed. |
| `ECR_FRONTEND_PUBLISH_ENABLED` | Keep `false` until the frontend ECR repository and publisher permissions are configured; then set `true` to enable frontend image publishing. |
| `EC2_DEPLOY_ENABLED` | Keep `false` until both images, both IAM roles, SSM connectivity, and the EC2 runtime preflight are verified; set `true` to enable automatic deployment. |

### AWS setup order

1. Review and apply the change set for `templates/ecr-repositories.yaml`; verify both immutable repositories exist in account `531767454878` in `us-east-1`.
2. Attach the statements in `policies/github-ecr-publisher.json` to the existing `GitHubActionsECRPushRole`. It scopes image push to the two repositories and does not allow repository or IAM changes. Verify its OIDC trust is restricted to this GitHub repository's `main` branch.
3. Attach/verify `policies/lead360-ec2-ecr-pull.json` on the existing instance role `lead360-ec2-ecr-role`. That role must pull from both repositories.
4. Confirm the AWS IAM OIDC provider exists for `https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. Provision `templates/github-ssm-deploy-role.yaml` with that provider ARN and subject `repo:abhijiit95/lead360:ref:refs/heads/main`. The template constrains the subject to this exact repository and branch, is separate from the ECR publisher role, and scopes Run Command to the stated EC2 instance. It grants `ssm:SendCommand` for `AWS-RunShellScript` on that instance and `ssm:GetCommandInvocation` to read its result. Because `AWS-RunShellScript` runs with SSM Agent privileges, the role can cause broad changes on that EC2 instance through shell commands even though it has no direct IAM or ECR API permissions; protect the branch and role trust accordingly.
5. Add the GitHub variables above, leaving both gates `false`. Verify SSM reports the instance online and the EC2 role can pull both images. Only enable publishing after the repository and publisher role are verified; only enable deployment after role trust, SSM access, image tags, and runtime checks are verified.

The SSM script at `scripts/deploy-ec2-images.sh` validates the live configuration before stopping an app container: container names, exact loopback port bindings, `lead360-network`, restart policy, API CA bind mount, frontend mounts, endpoint DNS names and MAC address, and Docker health-check settings. Supported shell-form health checks and their timing values are read from `docker inspect` and passed to the replacement; malformed settings and exec-form checks (which `docker run --health-cmd` would change to shell form) fail closed. Any mismatch aborts before stopping an app container. It snapshots the PostgreSQL and Redis container IDs/states and verifies they remain unchanged. It never stops, removes, recreates, renames, or otherwise changes either data-service container.

For runtime credentials, the script reads the running app containers' environment via `docker inspect` on EC2, writes those values to owner-only files in a private temporary directory, passes only those protected file paths to Docker, and removes the files on exit. Environment values are not sent to GitHub or printed in SSM output. If a value cannot be represented safely in the protected temporary env files, preflight fails before replacing a container. Both SHA-tagged images are pulled before either app container is stopped.

Replacement preserves the verified host bindings (`127.0.0.1:4000→4000` and `127.0.0.1:8080→8080`), shared network, API read-only CA mount, and `unless-stopped` policies. Existing entrypoint, command, user, working directory, environment, and network aliases are read from the live inspection. Old app containers are stopped, renamed to `*-previous-*`, and disconnected from `lead360-network` so they do not claim the new app's DNS name. They are retained and are not automatically deleted or restarted. If a replacement fails health checks, the workflow fails without automatic rollback. To recover manually, inspect `docker ps -a`; stop and rename the failed replacement out of the way, rename the retained previous container back to its original name, reconnect it with `docker network connect lead360-network <container-name>`, then verify its HTTP endpoint. Do not remove either container until recovery is confirmed.

Health verification checks Docker's running state, reports healthy when a Docker health check is configured, and checks repository endpoints: API `GET /api/health/ready`, frontend `GET /`, and the frontend Nginx proxy `GET /api/health/ready`. The API readiness route checks PostgreSQL, Redis, and the selected lead database; Nginx proxies `/api/` to `lead360-api:4000`. A container with no health check remains without one; an existing supported shell-form Docker health check is preserved alongside these HTTP checks.

### Manual deployment test

After AWS setup, leave `EC2_DEPLOY_ENABLED=false` and set `ECR_FRONTEND_PUBLISH_ENABLED=true` only after the frontend ECR repository and publisher permissions are confirmed. Push a commit to `main`, wait for `CI`, and confirm `publish-backend-to-ecr` and `publish-frontend-to-ecr` succeeded with tags matching the same full SHA. Verify the SSM role trust, instance role pull permissions, SSM online status, and runtime preflight requirements. Then set `EC2_DEPLOY_ENABLED=true` and use **Actions → Deploy LeadFlow360 to EC2 through SSM → Run workflow** on `main`; enter that SHA and check `confirm_ec2_deploy`. Once enabled, successful CI pushes to `main` deploy automatically. No deployment or AWS resource modification has been performed from this repository workspace.

The manual `.github/workflows/publish-ecr.yml` requires `confirm_ecr_publish=true`, runs only from `main`, and publishes only the API image with an immutable commit SHA tag. It checks the GitHub Actions API for a successful `push` CI run on `main` for the exact commit before requesting AWS credentials; its job has `actions: read` only for that check. Configure GitHub repository variables `AWS_REGION=us-east-1` and `AWS_ECR_PUBLISH_ROLE_ARN=arn:aws:iam::531767454878:role/GitHubActionsECRPushRole`. The automatic ECR jobs in `ci.yml` use the same role ARN directly. This is a pre-existing AWS role, not a role created by `iam-roles.yaml`; verify its exact GitHub repository/`main` OIDC trust subject and ECR push permissions in AWS. The workflows receive short-lived AWS credentials through OIDC; no AWS access key is stored in GitHub. CI builds/tests both applications and preserves GHCR publishing; its main-branch jobs publish the backend and, when enabled, frontend images to ECR.

The manual `.github/workflows/deploy-frontend-s3.yml` requires `confirm_frontend_deploy=true`, the `main` branch, and the GitHub `staging` environment. It also checks for successful `push` CI on the exact commit before requesting AWS credentials. Configure that environment with required reviewers and a branch restriction allowing only `main` before enabling deployment. Its IAM trust uses the exact `GitHubFrontendOidcSubject` for this repository's `staging` environment; GitHub's environment branch rule plus the workflow's `main` condition restricts the deployment branch. Check whether this repository uses GitHub's immutable subject claim format before setting the exact subject. The workflow builds static Vite assets with production URL validation, syncs to the configured private bucket without deleting old content-hashed assets, and invalidates the configured distribution. Configure `AWS_REGION`, `AWS_FRONTEND_DEPLOY_ROLE_ARN`, `FRONTEND_S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, and public `VITE_API_BASE_URL` GitHub repository variables. Its separate OIDC role can list the bucket, upload objects, and invalidate only the configured distribution; it cannot delete bucket objects. This does not deploy ECS services.

The frontend release workflow uses the public API URL and production validation, then syncs the static bundle. It retains old content-hashed assets so clients holding an older HTML document can still fetch them. Keep HTML revalidated and hashed build assets cacheable. The Docker/Nginx frontend image proxies same-origin `/api/` requests to the `lead360-api` Docker DNS alias; this proxy is not part of the static S3 + CloudFront deployment. The S3 workflow therefore requires an explicit public HTTPS `VITE_API_BASE_URL` unless a separately configured CloudFront `/api/*` origin behavior is introduced and reviewed:

```sh
VITE_API_BASE_URL=https://<API_DOMAIN> FRONTEND_BUILD_ENV=production npm --prefix frontend run build
aws s3 sync frontend/dist s3://<FRONTEND_BUCKET> --exclude index.html --cache-control 'public,max-age=31536000,immutable'
aws s3 cp frontend/dist/index.html s3://<FRONTEND_BUCKET>/index.html --content-type 'text/html' --cache-control 'no-cache,no-store,must-revalidate'
aws cloudfront create-invalidation --distribution-id <CLOUDFRONT_DISTRIBUTION_ID> --paths / /index.html
```

These are future deployment commands, not executed here. Old content-hashed assets are retained by the sync; add a separate reviewed retention policy if storage growth becomes material.

## Runtime configuration and secret placement

Build the frontend with `FRONTEND_BUILD_ENV=production` and `VITE_API_BASE_URL=https://<API_DOMAIN>`. The validator rejects localhost and requires HTTPS. This is public browser configuration, not a secret. Configure CloudFront's frontend domain and the API URL consistently; configure API `FRONTEND_ORIGIN=https://<FRONTEND_DOMAIN>`.

The Google OIDC session cookie is `HttpOnly`, `Secure` in production, and `SameSite=Lax`; the frontend calls the API with credentials. Choose frontend and API hostnames that are same-site (for example, subdomains under the same registrable domain). If they must be on unrelated registrable domains, the current cookie policy will not support browser fetches reliably; changing it to cross-site cookies requires a deliberate CSRF/security review before deployment.

The API and worker read runtime configuration from ECS task definitions. Keep secret values in Secrets Manager and inject them by ARN. Expected production variables include:

- API and worker: `NODE_ENV=production`, `DATABASE_TYPE=postgres`, `DATABASE_SSL=true`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `REDIS_URL`. PostgreSQL is the core database in every mode. MySQL settings (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`) are required only when `DATABASE_TYPE=mysql`; they are not needed by these PostgreSQL task definitions. MongoDB settings are required only when `DATABASE_TYPE=mongodb`.
- API: `PORT=4000`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_ORIGIN`; when Google integration is enabled, provide its client ID/secret and both exact HTTPS callback URLs. The token-encryption key is needed for delegated OAuth token persistence.
- Worker: `LEAD_FOLLOWUP_DELAY_SECONDS` and `LEAD_JOB_WORKER_CONCURRENCY` as needed.
- If MongoDB is selected as the lead adapter, configure `MONGODB_URI` and `MONGODB_DATABASE` for the API and worker.

The backend creates the MySQL connection pool lazily, only when the MySQL lead adapter is selected. The PostgreSQL task definitions therefore omit MySQL configuration and credentials. The first deployment can use PostgreSQL without provisioning a MySQL endpoint or secret.

## One-time database initialization and rollout order

Keep service creation behind the one-time schema initialization. The reviewed deployment order is:

1. Validate CloudFormation and all staging inputs locally. This validation does not create resources or incur AWS charges.
2. Provision prerequisite stacks only after separately authorizing the AWS work and confirming its cost: networking, data services, ECR, frontend hosting, and IAM roles.
3. Deploy `ecs-task-definitions.yaml` to register the API, worker, and DB-init task definitions against the selected immutable image SHA. Task definition registration does not launch tasks.
4. Deploy `ecs-cluster.yaml`; capture its `EcsClusterArn` output.
5. Run the registered DB-init task once, passing that cluster ARN and private subnet/security-group configuration. Confirm the task stopped with exit code 0 and review its sanitized logs.
6. Only after DB-init succeeds, deploy `ecs-services-alb.yaml`, passing `ClusterArn` from `EcsClusterArn`, the task-definition ARNs, and networking/certificate inputs. This is the step that creates the ALB and starts the API and worker services.
7. Verify ALB/API readiness and worker heartbeat/health before proceeding with DNS, OAuth callbacks, and frontend release.

The backend image includes `dist/database-init.js`. To run the DB-init task **once per schema rollout**, set these shell variables from the named CloudFormation stack outputs:

```sh
ECS_CLUSTER_ARN='<ecs-cluster stack output: EcsClusterArn>'
DB_INIT_TASK_DEFINITION_ARN='<ecs-task-definitions stack output: DbInitTaskDefinitionArn>'
PRIVATE_SUBNET_IDS='<networking stack output: PrivateSubnetIds, comma-separated>'
DB_INIT_SECURITY_GROUP_ID='<networking stack output: DbInitSecurityGroupId>'

aws ecs run-task \
  --cluster "$ECS_CLUSTER_ARN" \
  --launch-type FARGATE \
  --count 1 \
  --task-definition "$DB_INIT_TASK_DEFINITION_ARN" \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNET_IDS],securityGroups=[$DB_INIT_SECURITY_GROUP_ID],assignPublicIp=DISABLED}"
```

The networking stack also outputs `DatabaseSecurityGroupId`; pass it to `data-services.yaml`, which attaches it to RDS. Its PostgreSQL ingress allows `DbInitSecurityGroupId`, and the DB-init security group allows outbound PostgreSQL traffic. The data-services stack then outputs `DatabaseEndpointAddress`, which becomes task-definition parameter `DatabaseHost`. `DatabaseName` and `DatabaseUsername` are supplied to `data-services.yaml`; pass the same database name and username to `ecs-task-definitions.yaml` as `DatabaseName` and `DatabaseUser`. The database password Secret ARN is an externally supplied stack parameter, not a generated output. The task definition sets PostgreSQL connection variables and injects `DATABASE_PASSWORD` from `DatabasePasswordSecretArn`; do not put the password in this command or shell arguments. The initializer task role/execution role and secret access must also be configured through the task-definition/IAM stack inputs.

Wait for that task to exit successfully and inspect its sanitized CloudWatch log stream before deploying/updating API and worker services. The current command uses idempotent `CREATE ... IF NOT EXISTS`/guarded constraint DDL for PostgreSQL and MySQL, so rerunning the current bootstrap is intended to be non-destructive. It is not a versioned migration framework and does not migrate changed columns. MongoDB collection creation remains lazy on first write; its initializer path checks connectivity only. If the task fails, stop the rollout and inspect the failure before retrying. Do not run the initializer concurrently with API/worker rollout.

## Persistence, backups, and operations

Use RDS automated backups and point-in-time recovery; define retention and test restores. Keep the database in private subnets and restrict its security group to application tasks. Use managed Redis with TLS/authentication compatible with `REDIS_URL`; verify the Node Redis and ioredis clients' TLS/ACL settings in staging. Redis is required for BullMQ and OIDC transactions/session revocation, so it is not merely a disposable cache in this application.

Send API and worker stdout/stderr to separate CloudWatch log groups. Keep log retention finite and alert on unhealthy tasks, repeated restarts, database/Redis connectivity errors, and queue backlog. Worker retries are useful for transient failures; the current notification integrations are mocks and must be implemented before relying on delivery.

## Costs and blockers

Costs include always-running Fargate API/worker vCPU and memory, ALB hours and LCU use, RDS compute/storage/backups, managed Redis capacity, CloudWatch ingestion/storage, CloudFront/S3 requests and transfer, and NAT gateway/hourly/data processing. Start with one API and one worker, conservative measured task sizing, finite log retention, and a regional cost estimate. The single staging NAT is cheaper but less available than one NAT per AZ. Avoid production rollout until domain/certificates and Google callbacks exist, secrets are populated, IAM/OIDC trust is reviewed, frontend publishing is static S3/CloudFront, and the Socket.IO single-task limitation is accepted or a shared adapter is implemented. Notifications are still mocks and must be implemented before relying on delivery.

## OAuth/OIDC URLs and required variables

The backend mounts OAuth routes under `/api/oauth` and OIDC routes under `/api/oidc`. After choosing and validating the API HTTPS domain, register these exact Google redirect URLs and set the matching runtime variables:

```text
GOOGLE_OAUTH_REDIRECT_URI=https://<API_DOMAIN>/api/oauth/google/callback
GOOGLE_OIDC_REDIRECT_URI=https://<API_DOMAIN>/api/oidc/google/callback
FRONTEND_ORIGIN=https://<FRONTEND_DOMAIN>
```

For local development, the example callback values use HTTP localhost and `NODE_ENV=development`. Production requires `NODE_ENV=production`, HTTPS callbacks, `DATABASE_TYPE=postgres`, PostgreSQL `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `REDIS_URL`. The API additionally needs `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_ORIGIN`, and (when Google sign-in/delegated access is enabled) `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, the two callback URLs, `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`, and least-privilege `GOOGLE_OAUTH_SCOPES` as applicable. The worker needs PostgreSQL settings, `REDIS_URL`, `LEAD_FOLLOWUP_DELAY_SECONDS`, and `LEAD_JOB_WORKER_CONCURRENCY`. The DB-init task needs PostgreSQL settings only. Keep secrets in Secrets Manager, never GitHub variables or frontend bundles.

The frontend **Continue with Google** button navigates the browser to `GET /api/oidc/google/login`; Google returns to `GET /api/oidc/google/callback`, and the API redirects the browser to the frontend `/auth/callback` page after setting its LeadFlow360 session cookie. The page then checks `GET /api/oidc/session` with credentials. Delegated Drive access is a separate flow: an already authenticated LeadFlow360 JWT calls `POST /api/oauth/google/connect`, with callback `GET /api/oauth/google/callback`. Google OAuth/OIDC here is for Google user sign-in or Google API delegation. GitHub OIDC is a separate workflow-to-AWS role assumption mechanism.

For local Google Console setup, register `http://localhost:4000/api/oauth/google/callback` for delegated Google API access and `http://localhost:4000/api/oidc/google/callback` for Google sign-in. Production requires the finalized HTTPS API origin plus those same paths; keep both Google redirect URI settings byte-for-byte aligned with the registered values.

Before provisioning, validate CloudFormation with `cfn-lint` or equivalent. After separately authorizing and funding provisioning, create prerequisite stacks in dependency order: networking → data services and ECR → CloudFront frontend bucket/distribution → IAM roles (they need the ECR, log group, frontend bucket, and distribution ARNs). Then register task definitions, create the cluster, run and verify DB initialization, and only then create/update the ALB/API/worker services stack. Pass the cluster stack's `EcsClusterArn` output as the services stack's required `ClusterArn` parameter. Configure DNS and Google callbacks after the ALB/domain are ready, and enable the reviewed static frontend workflow only after those prerequisites. The log group ARNs can be supplied from the exact log group names and account/region before task definitions create the groups. For GitHub trust, supply exact ECR branch and staging-environment OIDC subjects; the `staging` GitHub Environment must have required reviewers and a `main`-only deployment branch rule. These are plans only; no AWS calls have been made.

## Required CloudFormation parameters

Parameters without defaults are required. Use prior stack outputs where available and keep account-specific values in a private staging runbook.

| Template | Required parameters | Parameters with defaults |
| --- | --- | --- |
| `networking.yaml` | `VpcCidr`, `PublicSubnetACidr`, `PublicSubnetBCidr`, `PrivateSubnetACidr`, `PrivateSubnetBCidr` | `AllowedClientIpv4Cidr` (currently open IPv4 ingress; narrow for restricted staging access). |
| `data-services.yaml` | `PrivateSubnetIds`, `DatabaseSecurityGroupId`, `RedisSecurityGroupId`, `DatabaseName`, `DatabaseUsername`, `DatabasePasswordSecretArn`, `PostgresEngineVersion`, `PostgresParameterGroupFamily`, `RedisEngineVersion`, `RedisAuthTokenSecretArn` | `DatabaseInstanceClass`, `DatabaseAllocatedStorageGiB`, `DatabaseMaxAllocatedStorageGiB`, `DatabaseMultiAz`, `DatabaseDeletionProtection`, `RedisNodeType`. Select a supported PostgreSQL engine/family pair and Valkey version for the chosen region. |
| `ecr-repositories.yaml` | None | None. |
| `frontend-cloudfront.yaml` | `FrontendDomainName`, `AcmCertificateArn` | `PriceClass`. The CloudFront ACM certificate must be in `us-east-1`. |
| `iam-roles.yaml` | `ApiEcrRepositoryArn`, `ApiSecretArns`, `WorkerSecretArns`, `DbInitSecretArns`, `ApiLogGroupArn`, `WorkerLogGroupArn`, `DbInitLogGroupArn`, `FrontendBucketArn`, `CloudFrontDistributionArn`, `GitHubOidcProviderArn`, `GitHubFrontendOidcSubject` | None. The existing ECR publishing role is external to this template. The frontend trust subject must exactly match GitHub's claim; never use wildcard subjects. |
| `ecs-task-definitions.yaml` | `ImageTag` (40-character commit SHA), `ApiRepositoryUri`, all six API/worker/DB-init execution/task role ARNs, `DatabaseHost`, `DatabaseName`, `DatabaseUser`, `RedisUrlSecretArn`, `DatabasePasswordSecretArn`, `JwtSecretArn`, `FrontendOrigin` | Log group names, `JwtExpiresIn`, `GoogleClientId`, OAuth/OIDC callback URLs, scopes, resource URL, `GoogleClientSecretArn`, `GoogleTokenEncryptionKeySecretArn`. Leave Google client ID and callback values empty when Google features are disabled; when client ID is set, CloudFormation rules require both secret ARNs and both callbacks. |
| `ecs-cluster.yaml` | None | `ClusterName` (`lead360-staging`). Outputs `EcsClusterArn` and `EcsClusterName`. |
| `ecs-services-alb.yaml` | `ClusterArn` (use `EcsClusterArn` from `ecs-cluster.yaml`), `VpcId`, `PublicSubnetIds`, `PrivateSubnetIds`, `AlbSecurityGroupId`, `ApiSecurityGroupId`, `WorkerSecurityGroupId`, `ApiCertificateArn`, `ApiTaskDefinitionArn`, `WorkerTaskDefinitionArn` | `ApiDesiredCount`, `WorkerDesiredCount`. |

The ECR template outputs the repository URI and ARN; networking and data templates output subnet/security-group and database/cache endpoint values; CloudFront outputs bucket/distribution values; IAM outputs ECS role ARNs and the frontend deploy role ARN; task definitions output task-definition ARNs. The existing ECR publish role is external and is not an IAM-template output. Use the same log group names in the IAM and task-definition stacks. The ECS service-linked role must exist, or the provisioning identity must be able to create it.

### Secrets Manager entries

ECS reads each whole `SecretString` (not a JSON key) for these task environment variables:

| Secret environment variable | Required SecretString |
| --- | --- |
| `DATABASE_PASSWORD` | RDS PostgreSQL master/application password matching `DatabaseUsername`. |
| `REDIS_URL` | TLS URL to the private Redis/Valkey endpoint with the auth token URL-encoded. Confirm both Node Redis and ioredis clients accept the selected URL/auth format. |
| `JWT_SECRET` | Strong random LeadFlow360 JWT signing secret. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth Web client secret; inject only when Google integration is enabled. |
| `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte key for encrypting stored delegated OAuth tokens; inject only when Google integration is enabled. |

`RedisAuthTokenSecretArn` separately supplies the ElastiCache `AuthToken` property. Use a printable ASCII token satisfying AWS's length and character rules. When Google is disabled, its client-secret and token-encryption-key ARNs may be omitted; setting a Google client ID activates CloudFormation rules requiring both ARNs and both redirect URIs. If Secrets Manager uses a customer-managed KMS key, add only the required `kms:Decrypt` permission to the relevant execution role.

## Local validation commands

These commands validate locally and do not access AWS:

```sh
cfn-lint infra/aws/templates/*.yaml
ruby -r yaml -e 'ARGV.each { |f| YAML.parse_file(f) }' infra/aws/templates/*.yaml .github/workflows/*.yml
git diff --check
npm --prefix backend run build
npm --prefix backend test
npm --prefix backend run test:integration
npm --prefix frontend test
VITE_API_BASE_URL="$API_HTTPS_URL" FRONTEND_BUILD_ENV=production npm --prefix frontend run build
```

Set `API_HTTPS_URL` to the real selected HTTPS API URL in the shell before the final frontend build; do not commit it as a secret because it is public browser configuration.
