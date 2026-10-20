# LeadFlow360 nonproduction staging configuration checklist

Fill these placeholders only after the staging account, region, domain names,
and network have been selected. Keep secret values in AWS Secrets Manager;
record secret ARNs here only in a private deployment runbook, not in Git.

## Account and source control

- [ ] AWS account ID: `<12-digit AWS account ID>`
- [ ] AWS region: `<AWS region>`
- [ ] GitHub repository owner: `<GitHub owner>`
- [ ] GitHub repository name: `<GitHub repository>`
- [ ] Verified default/publishing branch: `<branch>`
- [ ] Exact `sub` claim in the existing `GitHubActionsECRPushRole` trust
      policy for this repository and `main` branch; verify its format rather
      than assuming the template's old role subject parameter.
- [ ] Exact static frontend OIDC `sub` claim for the staging environment:
      `<GitHubFrontendOidcSubject; verify whether immutable IDs are included>`
- [ ] GitHub `staging` environment has required reviewers and allows only
      the intended deployment branch.
- [ ] Both publishing/deployment workflows require a successful `push` CI
      run for the exact commit before requesting AWS credentials.
- [ ] GitHub OIDC provider ARN: `<OIDC provider ARN>`
- [ ] Existing GitHub ECR publishing role ARN: `arn:aws:iam::531767454878:role/GitHubActionsECRPushRole`; this is an existing AWS role, not created by `iam-roles.yaml`.
- [ ] GitHub `AWS_ECR_PUBLISH_ROLE_ARN` repository variable matches the existing role ARN above; automatic CI currently uses that ARN directly.
- [ ] GitHub frontend deploy role ARN variable: `<role ARN>`
- [ ] GitHub Actions repository variables: `AWS_REGION=<region>`,
      `AWS_ECR_PUBLISH_ROLE_ARN=<API image role ARN>`,
      `AWS_FRONTEND_DEPLOY_ROLE_ARN=<static frontend role ARN>`,
      `FRONTEND_S3_BUCKET=<bucket name>`,
      `CLOUDFRONT_DISTRIBUTION_ID=<distribution ID>`,
      `VITE_API_BASE_URL=https://<API domain>`
- [ ] Confirm manual image publication is intentionally approved before
      setting `confirm_ecr_publish=true`.

## Domains and certificates

- [ ] Frontend domain: `<frontend domain>`
- [ ] API domain: `<API domain>`
- [ ] ACM certificate ARN for CloudFront in `us-east-1`:
      `<CloudFront certificate ARN>`
- [ ] ACM certificate ARN for the API ALB in its deployment region:
      `<ALB certificate ARN>`
- [ ] API and frontend DNS names resolve to the ALB and CloudFront
      distribution respectively after those resources are provisioned.
- [ ] DNS records point the frontend domain to CloudFront and the API domain
      to the ALB.
- [ ] API CORS origin is exactly `https://<frontend domain>`.
- [ ] Frontend and API domains are same-site so the production
      `SameSite=Lax; Secure; HttpOnly` session cookie works on credentialed
      browser API requests; unrelated domains require a reviewed CSRF/cookie
      design change before deployment.
- [ ] Frontend build uses `VITE_API_BASE_URL=https://<API domain>` and
      `FRONTEND_BUILD_ENV=production`.

## VPC and network

- [ ] VPC ID: `<VPC ID>`
- [ ] Public ALB subnet IDs in at least two Availability Zones:
      `<public subnet IDs>`
- [ ] Private ECS subnet IDs in at least two Availability Zones:
      `<private application subnet IDs>`
- [ ] Select CIDRs for the VPC and four subnets that do not overlap any
      connected or peered network; the current staging template uses one NAT
      gateway in one AZ, which is a cost-saving availability tradeoff.
- [ ] Private RDS subnet IDs / DB subnet group: `<private DB subnets>`
- [ ] Redis subnet group / private subnets: `<private Redis subnets>`
- [ ] ALB security group ID: `<ALB security group ID>`
- [ ] ECS API/worker security group ID: `<application security group ID>`
- [ ] RDS security group ID: `<RDS security group ID>`
- [ ] Redis security group ID: `<Redis security group ID>`
- [ ] ALB accepts HTTPS from approved client networks; API task ingress on
      TCP 4000 is allowed only from the ALB security group.
- [ ] RDS TCP 5432 and Redis service port are allowed only from the
      application task security group (and the one-off DB-init task).
- [ ] Private tasks can reach ECR API/Docker endpoints, S3 image layers,
      Secrets Manager, and CloudWatch Logs through VPC endpoints or approved
      NAT egress.
- [ ] Private tasks have controlled outbound HTTPS access to Google OAuth/OIDC
      endpoints. No inbound access is opened for the worker.
- [ ] Security-group outbound rules allow ALB-to-API TCP 4000; API/worker-to-
      PostgreSQL TCP 5432 and Valkey TCP 6379; and task HTTPS egress TCP 443
      through NAT for ECR, Secrets Manager, CloudWatch Logs, and Google. RDS
      and Valkey have no client-initiated egress rules.

## Container registry and ECS

- [ ] ECR API repository URI: `<account>.dkr.ecr.<region>.amazonaws.com/lead360-api`
- [ ] ECR contains only `lead360-api`; API and worker use the same immutable
      full commit SHA image tag.
- [ ] Select an immutable full Git SHA image tag: `<40-character Git SHA>`.
- [ ] ECS cluster name/ARN: `<cluster name or ARN>`
- [ ] Confirm the ECS service-linked role exists or the provisioning identity
      is authorized to create it.
- [ ] API/worker/DB-init execution role ARNs:
      `<API execution role ARN>` / `<worker execution role ARN>` /
      `<DB-init execution role ARN>`
- [ ] API/worker/DB-init task role ARNs:
      `<API task role ARN>` / `<worker task role ARN>` /
      `<DB-init task role ARN>`
- [ ] API and worker service names: `<API service>` / `<worker service>`
- [ ] API task definition family/revision: `<API task definition>`
- [ ] Worker task definition family/revision: `<worker task definition>`
- [ ] DB-init task definition family/revision: `<DB-init task definition>`
- [ ] API desired count: `1`; worker desired count: `1` for initial staging.
- [ ] Confirm the ALB target group uses container port 4000 and
      `/api/health/ready` for health checks.
- [ ] Confirm the existing ECR role trusts only this GitHub repository's
      `main` workflow subject and can push only to `lead360-api`; verify the
      live role policy in AWS. The CloudFormation IAM template does not create
      or modify that existing role.
- [ ] Confirm the ECS API execution role, worker execution role, and DB-init
      execution role can read only their required secrets and write to their
      own CloudWatch log groups. Keep task roles separate and without AWS
      permissions unless a specific application feature requires them.
- [ ] Confirm log groups and retention policy: `<log group names>` /
      `<retention period>`.

## PostgreSQL, Redis, and secrets

- [ ] RDS PostgreSQL endpoint: `<RDS endpoint hostname>`
- [ ] RDS engine version and matching parameter group family:
      `<supported PostgreSQL version>` / `<matching postgres major family>`
- [ ] Database name: `<database name>`
- [ ] Database username: `<database username>`
- [ ] PostgreSQL password secret ARN: `<Secrets Manager ARN>`
- [ ] PostgreSQL password is stored as the whole SecretString expected by the
      ECS `DATABASE_PASSWORD` injection (not a JSON document/key).
- [ ] PostgreSQL TLS is enabled in API, worker, and DB-init tasks with
      certificate validation; RDS accepts traffic only on its private SG.
- [ ] Redis-compatible endpoint and TLS/port: `<private Redis endpoint>` /
      `<TLS port>`
- [ ] Redis URL secret ARN: `<Secrets Manager ARN>`; use the scheme and TLS/auth
      options supported by both Node Redis and ioredis clients.
- [ ] Redis URL SecretString uses the private endpoint and URL-encodes the
      auth token so both clients can parse it safely.
- [ ] Redis auth-token secret ARN: `<Secrets Manager ARN>`; the token must meet
      ElastiCache's supported token character/length constraints. The
      application `REDIS_URL` secret includes the selected endpoint and token.
- [ ] JWT secret ARN: `<Secrets Manager ARN>`
- [ ] If Google integration is enabled, Google OAuth client secret ARN:
      `<Secrets Manager ARN>`
- [ ] If Google integration is enabled, Google OAuth token-encryption key ARN:
      `<Secrets Manager ARN>`
- [ ] OAuth token-encryption key SecretString is base64 encoded and decodes
      to exactly 32 bytes; do not place its value in this checklist.
- [ ] Confirm secret JSON/key formats match the ECS `ValueFrom` references.
- [ ] Configure backups, retention, encryption, and a restore test for RDS.
- [ ] Run the one-off `npm run db:init` ECS task in private subnets before API
      and worker rollout; verify task exit status and logs before proceeding.

## Google OAuth/OIDC

- [ ] Register exact OAuth callback:
      `https://<API domain>/api/oauth/google/callback`
- [ ] Register exact OIDC callback:
      `https://<API domain>/api/oidc/google/callback`
- [ ] Configure the matching `GOOGLE_OAUTH_REDIRECT_URI` and
      `GOOGLE_OIDC_REDIRECT_URI` runtime values.
- [ ] Configure the Google client ID, client secret, and the least-privilege
      OAuth scopes/resource URL needed for enabled features.
- [ ] For local development, Google Console redirect URIs are exactly
      `http://localhost:4000/api/oauth/google/callback` and
      `http://localhost:4000/api/oidc/google/callback` for the respective flows.
- [ ] Production Google Console redirect URIs use the finalized HTTPS API
      domain with those same paths; never register the documentation placeholder.
- [ ] Remember Google OAuth/OIDC is user sign-in/delegated access; GitHub OIDC
      separately lets repository workflows assume AWS roles.
- [ ] Confirm Google consent-screen test-user/publishing requirements for the
      staging users.

## Release and runtime checks

- [ ] Confirm the frontend uses the manual, confirmed static S3/CloudFront
      workflow; it must not be published as an ECR container image.
- [ ] Build frontend assets with the selected HTTPS API URL; publish assets to
      the private bucket and invalidate/revalidate CloudFront as required.
- [ ] Deploy one API task and one worker task; verify API readiness, worker
      heartbeat, database connectivity, Redis/BullMQ connectivity, logs, and
      OAuth callbacks.
- [ ] Keep API desired count at one until a shared Socket.IO adapter and the
      load-balancer transport strategy are implemented and verified.
- [ ] Review estimated regional costs for Fargate, ALB, RDS, managed Redis,
      CloudWatch, CloudFront/S3, and NAT/VPC endpoints before enabling staging.

## Required CloudFormation inputs

Use stack outputs and approved account configuration for actual values. The
complete descriptions and secret formats are in `infra/aws/README.md`.

- [ ] `networking.yaml`: `VpcCidr`, `PublicSubnetACidr`, `PublicSubnetBCidr`,
      `PrivateSubnetACidr`, `PrivateSubnetBCidr`; optionally restrict
      `AllowedClientIpv4Cidr`.
- [ ] `data-services.yaml`: `PrivateSubnetIds`, `DatabaseSecurityGroupId`,
      `RedisSecurityGroupId`, `DatabaseName`, `DatabaseUsername`,
      `DatabasePasswordSecretArn`, `PostgresEngineVersion`,
      `PostgresParameterGroupFamily`, `RedisEngineVersion`,
      `RedisAuthTokenSecretArn`.
- [ ] `ecr-repositories.yaml`: no parameters; capture its repository URI/ARN.
- [ ] `frontend-cloudfront.yaml`: `FrontendDomainName`, `AcmCertificateArn`;
      optionally `PriceClass`. CloudFront certificate must be in `us-east-1`.
- [ ] `iam-roles.yaml`: `ApiEcrRepositoryArn`,
      `ApiSecretArns`, `WorkerSecretArns`, `DbInitSecretArns`,
      `ApiLogGroupArn`, `WorkerLogGroupArn`, `DbInitLogGroupArn`,
      `FrontendBucketArn`, `CloudFrontDistributionArn`,
      `GitHubOidcProviderArn`, `GitHubFrontendOidcSubject`. The existing
      `GitHubActionsECRPushRole` is external and is not a template parameter.
- [ ] `ecs-task-definitions.yaml`: `ImageTag`, `ApiRepositoryUri`, all six
      API/worker/DB-init execution and task role ARNs, `DatabaseHost`,
      `DatabaseName`, `DatabaseUser`, `RedisUrlSecretArn`,
      `DatabasePasswordSecretArn`, `JwtSecretArn`, `FrontendOrigin`; optional
      Google client ID, callbacks, scopes, resource URL, Google secret ARNs,
      JWT expiry, and log group names. When client ID is set, CloudFormation
      rules require both Google secret ARNs and both callback URLs.
- [ ] `ecs-services-alb.yaml`: `VpcId`, `PublicSubnetIds`, `PrivateSubnetIds`,
      `AlbSecurityGroupId`, `ApiSecurityGroupId`, `WorkerSecurityGroupId`,
      `ApiCertificateArn`, `ApiTaskDefinitionArn`, `WorkerTaskDefinitionArn`;
      optionally cluster name and desired counts.

## Local validation commands

- [ ] `cfn-lint infra/aws/templates/*.yaml`
- [ ] `actionlint .github/workflows/*.yml`
- [ ] Backend build/tests, frontend tests/production build, and
      `git diff --check` all pass before any future deployment.
- [ ] Review CloudFormation changesets, IAM trust, and network exposure before
      provisioning; these templates have not been deployed.
