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

Start with one API task and one worker task. `networking.yaml` creates two public subnets and two private subnets across the first two AZs in the selected region. The staging template uses one NAT gateway to reduce idle cost; this is a single-AZ egress dependency and should be changed to one NAT gateway per AZ for a production availability target. Place the ALB in public subnets and API, worker, RDS, and Redis in private subnets. API ingress on TCP 4000 is allowed only from the ALB security group. PostgreSQL 5432 and Redis 6379 ingress is allowed only from API, worker, and (for PostgreSQL) the one-off DB-init task security groups. The worker has no inbound listener. Do not publish database/cache ports publicly.

Private task subnets route outbound through NAT so Fargate can retrieve ECR images and image layers, read Secrets Manager values, write CloudWatch logs, and reach Google OAuth/OIDC endpoints over HTTPS. This template uses NAT rather than VPC endpoints to avoid endpoint hourly charges in an initial staging stack. A production design can use ECR API/Docker, S3, Secrets Manager, and CloudWatch Logs VPC endpoints and retain controlled NAT/proxy egress for Google. Review endpoint security groups, private DNS, and task execution-role permissions together.

The API currently uses the default in-memory Socket.IO adapter. One API task avoids cross-task event propagation, but scaling beyond one requires a supported shared adapter and a load-balancer transport plan. Do not assume the existing Redis cache or BullMQ connections provide Socket.IO event sharing.

## Templates

- `templates/ecr-repositories.yaml` creates the encrypted, scan-on-push, immutable `lead360-api` ECR repository. Publish full Git SHA tags only. It expires untagged images after 14 days and retains the 30 most recently pushed tagged images.
- `templates/iam-roles.yaml` separates API, worker, and DB-init execution roles from three no-permission application task roles. API, worker, and DB-init execution roles all pull the same API image, and all use the single `ApiEcrRepositoryArn` parameter so their repository permission cannot drift. Separate GitHub OIDC roles publish the API image or deploy static frontend assets. The ECR role trusts an exact repository/branch subject; the frontend role trusts an exact repository/environment subject, with the `staging` environment's branch protection providing the branch restriction. Supply exact ECR, log group, bucket, distribution, and secret ARNs. Add narrowly scoped `kms:Decrypt` to execution roles only if referenced secrets use a customer-managed KMS key.
- `templates/ecs-task-definitions.yaml` defines API, worker, and one-off initializer Fargate tasks. The initial 512 CPU / 1024 MiB settings are valid Fargate sizing examples, not load-tested recommendations. The API command comes from the backend image (`node dist/server.js`); worker uses `node dist/worker.js`; DB initialization runs `npm run db:init` in `/app/backend`. API checks `/api/health/ready`; worker checks its Redis-dependent heartbeat. API and worker have a 120-second stop timeout for graceful shutdown.
- `templates/networking.yaml` creates the VPC, two-AZ subnet layout, staging NAT, and least-ingress security groups. CIDRs must be selected to avoid overlap with connected networks.
- `templates/data-services.yaml` creates private, encrypted RDS PostgreSQL and TLS/auth-enabled ElastiCache Valkey. It expects a Secrets Manager PostgreSQL password and Valkey auth token. The initial Redis configuration is single-node/no-failover and the database defaults to single-AZ; adjust both before production availability commitments.
- `templates/ecs-services-alb.yaml` creates the ECS cluster, public ALB with HTTP-to-HTTPS redirect, HTTPS listener, readiness target group, and private API/worker Fargate services. It expects task-definition ARNs and network outputs from the prior stacks. Configure DNS to alias the API domain to the ALB output.
- `templates/frontend-cloudfront.yaml` defines a private, encrypted S3 bucket, CloudFront Origin Access Control, HTTPS-only distribution, and SPA route fallback. It does not upload the Vite build. CloudFront ACM certificates must be in `us-east-1`; choose a real domain and certificate before deploying.

All templates currently pass local `cfn-lint` validation. This checks template/resource schemas locally; it does not validate against a live AWS account, confirm account-specific quotas or service availability, or replace review of a CloudFormation change set. No AWS validation or deployment has been performed. Before provisioning, review stack exports/parameters, IAM, CIDR overlap, service quotas/region support, certificate/domain ownership, and resource replacement/deletion behavior. The DB-init task definition is configured in the task-definition template and uses the DB-init security group when run as a one-off Fargate task.

## ECR image convention and GitHub OIDC

The only application container repository is `lead360-api`; the worker uses that same backend image. Tag it with the full Git commit SHA:

```text
<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/lead360-api:<GIT_SHA>
```

The manual `.github/workflows/publish-ecr.yml` requires `confirm_ecr_publish=true`, runs only from `main`, and publishes only the API image with an immutable commit SHA tag. It checks the GitHub Actions API for a successful `push` CI run on `main` for the exact commit before requesting AWS credentials; its job has `actions: read` only for that check. Configure GitHub repository variables `AWS_REGION` and `AWS_ECR_PUBLISH_ROLE_ARN`. Set up the GitHub OIDC provider and supply the exact `GitHubEcrOidcSubject` claim for this repository and branch. GitHub subject claims may include immutable owner/repository IDs, so confirm the exact format for this repository before creating the trust role. The workflow receives short-lived AWS credentials through OIDC; no AWS access key is stored in GitHub. The publishing role can push only to the API ECR repository. CI remains separately defined and builds/tests both applications without publishing images.

The manual `.github/workflows/deploy-frontend-s3.yml` requires `confirm_frontend_deploy=true`, the `main` branch, and the GitHub `staging` environment. It also checks for successful `push` CI on the exact commit before requesting AWS credentials. Configure that environment with required reviewers and a branch restriction allowing only `main` before enabling deployment. Its IAM trust uses the exact `GitHubFrontendOidcSubject` for this repository's `staging` environment; GitHub's environment branch rule plus the workflow's `main` condition restricts the deployment branch. Check whether this repository uses GitHub's immutable subject claim format before setting the exact subject. The workflow builds static Vite assets with production URL validation, syncs to the configured private bucket without deleting old content-hashed assets, and invalidates the configured distribution. Configure `AWS_REGION`, `AWS_FRONTEND_DEPLOY_ROLE_ARN`, `FRONTEND_S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, and public `VITE_API_BASE_URL` GitHub repository variables. Its separate OIDC role can list the bucket, upload objects, and invalidate only the configured distribution; it cannot delete bucket objects. This does not deploy ECS services.

The frontend release workflow uses the public API URL and production validation, then syncs the static bundle. It retains old content-hashed assets so clients holding an older HTML document can still fetch them. Keep HTML revalidated and hashed build assets cacheable:

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
- API: `PORT=4000`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_ORIGIN`, Google OAuth client ID/secret and exact HTTPS callback URLs when those modules are used; Google OAuth token encryption key is needed for delegated token persistence.
- Worker: `LEAD_FOLLOWUP_DELAY_SECONDS` and `LEAD_JOB_WORKER_CONCURRENCY` as needed.
- If MongoDB is selected as the lead adapter, configure `MONGODB_URI` and `MONGODB_DATABASE` for the API and worker.

The backend creates the MySQL connection pool lazily, only when the MySQL lead adapter is selected. The PostgreSQL task definitions therefore omit MySQL configuration and credentials. The first deployment can use PostgreSQL without provisioning a MySQL endpoint or secret.

## One-time database initialization and rollout order

The backend image includes `dist/database-init.js`. Build/test and publish an immutable API image, then register the task definitions. Run the database-init task **once per schema rollout** in private subnets using the database security group and the required DB secrets:

```sh
aws ecs run-task \
  --cluster <ECS_CLUSTER_ARN_OR_NAME> \
  --launch-type FARGATE \
  --task-definition <DB_INIT_TASK_DEFINITION_ARN> \
  --network-configuration 'awsvpcConfiguration={subnets=[<PRIVATE_SUBNET_IDS>],securityGroups=[<DB_CLIENT_SECURITY_GROUP_ID>],assignPublicIp=DISABLED}'
```

Wait for that task to exit successfully and inspect its sanitized CloudWatch log stream before deploying/updating API and worker services. The current command uses idempotent `CREATE ... IF NOT EXISTS`/guarded constraint DDL for PostgreSQL and MySQL, so rerunning the current bootstrap is intended to be non-destructive. It is not a versioned migration framework and does not migrate changed columns. MongoDB collection creation remains lazy on first write; its initializer path checks connectivity only.

Suggested release order: tests → immutable ECR images → one-off DB initialization → API service rollout and readiness → worker rollout and heartbeat health → frontend build with the API HTTPS URL → S3 sync and CloudFront invalidation. Do not run the initializer concurrently with API/worker rollout.

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

Before provisioning, validate CloudFormation with `cfn-lint` or equivalent. Deploy in dependency order: networking → data services and ECR → CloudFront frontend bucket/distribution → IAM roles (they need the ECR, log group, frontend bucket, and distribution ARNs) → task definitions → ALB/ECS services. Then configure DNS and Google callbacks, and only then enable the reviewed static frontend workflow. The log group ARNs can be supplied from the exact log group names and account/region before task definitions create the groups. For GitHub trust, supply exact ECR branch and staging-environment OIDC subjects; the `staging` GitHub Environment must have required reviewers and a `main`-only deployment branch rule. Run the DB-init task once before API/worker service rollout. These are plans only; no AWS calls have been made.

## Required CloudFormation parameters

Parameters without defaults are required. Use prior stack outputs where available and keep account-specific values in a private staging runbook.

| Template | Required parameters | Parameters with defaults |
| --- | --- | --- |
| `networking.yaml` | `VpcCidr`, `PublicSubnetACidr`, `PublicSubnetBCidr`, `PrivateSubnetACidr`, `PrivateSubnetBCidr` | `AllowedClientIpv4Cidr` (currently open IPv4 ingress; narrow for restricted staging access). |
| `data-services.yaml` | `PrivateSubnetIds`, `DatabaseSecurityGroupId`, `RedisSecurityGroupId`, `DatabaseName`, `DatabaseUsername`, `DatabasePasswordSecretArn`, `PostgresEngineVersion`, `PostgresParameterGroupFamily`, `RedisEngineVersion`, `RedisAuthTokenSecretArn` | `DatabaseInstanceClass`, `DatabaseAllocatedStorageGiB`, `DatabaseMaxAllocatedStorageGiB`, `DatabaseMultiAz`, `DatabaseDeletionProtection`, `RedisNodeType`. Select a supported PostgreSQL engine/family pair and Valkey version for the chosen region. |
| `ecr-repositories.yaml` | None | None. |
| `frontend-cloudfront.yaml` | `FrontendDomainName`, `AcmCertificateArn` | `PriceClass`. The CloudFront ACM certificate must be in `us-east-1`. |
| `iam-roles.yaml` | `ApiEcrRepositoryArn`, `ApiSecretArns`, `WorkerSecretArns`, `DbInitSecretArns`, `ApiLogGroupArn`, `WorkerLogGroupArn`, `DbInitLogGroupArn`, `FrontendBucketArn`, `CloudFrontDistributionArn`, `GitHubOidcProviderArn`, `GitHubEcrOidcSubject`, `GitHubFrontendOidcSubject` | None. Trust subjects must exactly match the claims GitHub issues; never use wildcard subjects. |
| `ecs-task-definitions.yaml` | `ImageTag` (40-character commit SHA), `ApiRepositoryUri`, all six API/worker/DB-init execution/task role ARNs, `DatabaseHost`, `DatabaseName`, `DatabaseUser`, `RedisUrlSecretArn`, `DatabasePasswordSecretArn`, `JwtSecretArn`, `GoogleClientSecretArn`, `GoogleTokenEncryptionKeySecretArn`, `FrontendOrigin` | Log group names, `JwtExpiresIn`, `GoogleClientId`, OAuth/OIDC callback URLs, scopes, resource URL. Set the Google values when enabling those features. |
| `ecs-services-alb.yaml` | `VpcId`, `PublicSubnetIds`, `PrivateSubnetIds`, `AlbSecurityGroupId`, `ApiSecurityGroupId`, `WorkerSecurityGroupId`, `ApiCertificateArn`, `ApiTaskDefinitionArn`, `WorkerTaskDefinitionArn` | `ClusterName`, `ApiDesiredCount`, `WorkerDesiredCount`. |

The ECR template outputs repository URI; networking and data templates output the subnet/security group and database/cache endpoint values; CloudFront outputs bucket/distribution values; IAM and task definitions output role/task-definition ARNs. Use the same log group names in the IAM and task-definition stacks. The ECS service-linked role must exist, or the provisioning identity must be able to create it.

### Secrets Manager entries

ECS reads each whole `SecretString` (not a JSON key) for these task environment variables:

| Secret environment variable | Required SecretString |
| --- | --- |
| `DATABASE_PASSWORD` | RDS PostgreSQL master/application password matching `DatabaseUsername`. |
| `REDIS_URL` | TLS URL to the private Redis/Valkey endpoint with the auth token URL-encoded. Confirm both Node Redis and ioredis clients accept the selected URL/auth format. |
| `JWT_SECRET` | Strong random LeadFlow360 JWT signing secret. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth Web client secret. |
| `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte key for encrypting stored delegated OAuth tokens. |

`RedisAuthTokenSecretArn` separately supplies the ElastiCache `AuthToken` property. Use a printable ASCII token satisfying AWS's length and character rules. If Secrets Manager uses a customer-managed KMS key, add only the required `kms:Decrypt` permission to the relevant execution role.

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
