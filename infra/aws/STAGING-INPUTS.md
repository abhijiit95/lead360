# LeadFlow360 staging deployment inputs

Local planning manifest only. It contains placeholders and secret references,
never secret values. Do not commit actual staging IDs, domains, or secret ARNs
in this file. `PENDING` means the value has not been supplied or verified.

## Deployment order

1. Validate configuration and collect the inputs below locally.
2. Provision prerequisite stacks only after separately authorizing the work
   and confirming the cost: networking, data services, ECR, frontend hosting,
   and IAM roles.
3. Deploy `ecs-task-definitions.yaml` to register API, worker, and DB-init
   task definitions for the selected published image SHA.
4. Deploy `ecs-cluster.yaml`; capture `EcsClusterArn`.
5. Run the DB-init task using the cluster/task-definition/network outputs.
   Confirm successful task exit before continuing.
6. Deploy `ecs-services-alb.yaml` only after DB-init succeeds. Pass the
   cluster output as `ClusterArn`; then verify API readiness and worker health.

## Status key

- **Documented**: a template or repository doc supplies a default or exact
  naming/convention. It does not mean an AWS resource exists.
- **External — PENDING**: an operator must choose or supply the value.
- **Stack output — PENDING**: the named stack must be provisioned before its
  value exists.
- Sensitivity describes the value/reference, never a secret value. Secret
  entries below are ARN references only.

## Deployment context

| Input | Source | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| AWS account ID and region | Approved staging account/configuration; templates use AWS pseudo parameters | **External — PENDING verification** | No; account metadata | All stack deployments; region must support selected services and certificates |
| API domain and DNS record | External domain/DNS configuration; ALB stack outputs `ApiLoadBalancerDnsName` and `ApiLoadBalancerCanonicalHostedZoneId` | **External — PENDING** | No | ALB certificate, DNS, frontend API URL, OAuth callbacks |
| Frontend domain and DNS record | External domain/DNS configuration; CloudFront output `FrontendDistributionDomainName` | **External — PENDING** | No | Frontend stack, DNS, `FrontendOrigin`, GitHub frontend deployment |
| Google OAuth/OIDC callback URLs | Derived from selected API domain and documented routes `/api/oauth/google/callback` and `/api/oidc/google/callback` | **External — PENDING** | No | Task definitions and Google Console configuration |
| Production frontend API URL | Selected HTTPS API URL; `VITE_API_BASE_URL` | **External — PENDING** | No; public browser config | Frontend build and static release |
| GitHub repository owner/name, publishing branch, staging environment and exact OIDC subject | GitHub repository/environment settings | **External — PENDING verification**; docs require `main` and a reviewed `staging` environment | No; identity policy metadata | IAM GitHub OIDC role and protected workflows |
| Existing GitHub ECR publishing role | Repository documentation names `GitHubActionsECRPushRole`; live trust/policy is not verified here | **Documented; AWS-side verification PENDING** | No; role identifier | Image publishing workflow |

## `networking.yaml`

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `VpcCidr` | Operator-selected non-overlapping VPC CIDR | **External — PENDING** | Network detail; restrict distribution | Prerequisite: networking |
| `PublicSubnetACidr`, `PublicSubnetBCidr` | Operator-selected CIDRs in separate AZs | **External — PENDING** | Network detail; restrict distribution | Prerequisite: networking / public ALB |
| `PrivateSubnetACidr`, `PrivateSubnetBCidr` | Operator-selected CIDRs in separate AZs | **External — PENDING** | Network detail; restrict distribution | Prerequisite: networking / ECS, RDS, Valkey |
| `AllowedClientIpv4Cidr` | Template default `0.0.0.0/0`; should be reviewed/narrowed for staging | **Documented default; decision PENDING** | Network/security configuration | Prerequisite: networking / ALB ingress |
| `VpcId` | Output of `networking.yaml` | **Stack output — PENDING** | No | Data/services and ALB/services stacks |
| `PublicSubnetIds` | Output of `networking.yaml` (comma-separated) | **Stack output — PENDING** | Network detail | ALB/services stack |
| `PrivateSubnetIds` | Output of `networking.yaml` (comma-separated) | **Stack output — PENDING** | Network detail | Data-services stack, DB-init task, ECS services |
| `AlbSecurityGroupId`, `ApiSecurityGroupId`, `WorkerSecurityGroupId` | Outputs of `networking.yaml` | **Stack output — PENDING** | Network/security metadata | ALB/API/worker services stack |
| `DbInitSecurityGroupId` | Output of `networking.yaml` | **Stack output — PENDING** | Network/security metadata | One-off DB-init task |
| `DatabaseSecurityGroupId`, `RedisSecurityGroupId` | Outputs of `networking.yaml` | **Stack output — PENDING** | Network/security metadata | Data-services stack; database/cache access rules |
| `NatGatewayId` | Output of `networking.yaml` | **Stack output — PENDING** | No | Egress troubleshooting/operations |

## `data-services.yaml` (PostgreSQL and Valkey)

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `PrivateSubnetIds` | `networking.yaml` output `PrivateSubnetIds` | **Stack output — PENDING** | Network detail | Prerequisite: private data subnets |
| `DatabaseSecurityGroupId`, `RedisSecurityGroupId` | Matching outputs of `networking.yaml` | **Stack output — PENDING** | Network/security metadata | Prerequisite: RDS and Valkey network access |
| `DatabaseName`, `DatabaseUsername` | Operator-selected application database settings | **External — PENDING** | Username is not a password; treat as operational metadata | Data-services creation and task-definition configuration |
| `DatabasePasswordSecretArn` | Secrets Manager secret containing the PostgreSQL password | **External — PENDING** | **Yes—ARN reference only** | Data-services creation; also pass to `ecs-task-definitions.yaml` |
| `PostgresEngineVersion`, `PostgresParameterGroupFamily` | Compatible values supported in selected AWS region | **External — PENDING selection** | No | Data-services creation |
| `RedisEngineVersion` | Supported Valkey version for selected region | **External — PENDING selection** | No | Data-services creation |
| `DatabaseInstanceClass` (`db.t4g.micro`), `DatabaseAllocatedStorageGiB` (`20`), `DatabaseMaxAllocatedStorageGiB` (`100`), `DatabaseMultiAz` (`false`), `DatabaseDeletionProtection` (`true`), `RedisNodeType` (`cache.t4g.micro`) | Template defaults | **Documented defaults; affordability/configuration review PENDING** | No | Data-services creation |
| `RedisAuthTokenSecretArn` | Secrets Manager secret containing the Valkey auth token | **External — PENDING** | **Yes—ARN reference only** | Data-services creation |
| `DatabaseEndpointAddress`, `DatabaseEndpointPort`, `DatabaseInstanceIdentifier` | Outputs of `data-services.yaml` | **Stack output — PENDING** | Endpoint is private infrastructure metadata | `DatabaseHost` and database connectivity checks |
| `RedisPrimaryEndpointAddress`, `RedisPrimaryEndpointPort`, `RedisReplicationGroupId` | Outputs of `data-services.yaml` | **Stack output — PENDING** | Private infrastructure metadata | Construct `REDIS_URL` secret; Redis connectivity |

## `ecr-repositories.yaml`

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| Parameters | This template defines none | **Documented** | — | ECR prerequisite |
| `ApiRepositoryUri`, `ApiRepositoryArn` | Outputs of `ecr-repositories.yaml`; repository name in template is `lead360-api` | **Stack output — PENDING** | No | IAM and task definitions; image URI |
| `ImageTag` | Full lowercase 40-character Git commit SHA, already published to ECR | **External — PENDING selection/publication** | No | Task-definition registration and DB-init image |

## Frontend hosting prerequisite (`frontend-cloudfront.yaml`)

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `FrontendDomainName` | Chosen frontend domain | **External — PENDING** | No | CloudFront distribution and frontend DNS |
| `AcmCertificateArn` | Issued certificate for frontend domain; template requires CloudFront certificate in `us-east-1` | **External — PENDING** | No; ARN metadata | CloudFront distribution |
| `PriceClass` (`PriceClass_100`) | Template default | **Documented default; decision PENDING** | No | CloudFront distribution |
| `FrontendBucketName`, `FrontendBucketArn`, `FrontendDistributionId`, `FrontendDistributionArn`, `FrontendDistributionDomainName` | Outputs of `frontend-cloudfront.yaml` | **Stack output — PENDING** | No | IAM parameters, GitHub frontend deployment, DNS |

## `iam-roles.yaml`

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `ApiSecretArns` | Secret ARN references injected into API task (`DATABASE_PASSWORD`, `REDIS_URL`, `JWT_SECRET`, and optional Google secrets) | **External — PENDING** | **Yes—ARN references only** | IAM execution-role policy |
| `WorkerSecretArns` | Secret ARN references injected into worker (`DATABASE_PASSWORD`, `REDIS_URL`) | **External — PENDING** | **Yes—ARN references only** | IAM execution-role policy |
| `DbInitSecretArns` | Database password secret ARN reference | **External — PENDING** | **Yes—ARN reference only** | IAM initializer execution-role policy |
| `ApiLogGroupArn`, `WorkerLogGroupArn`, `DbInitLogGroupArn` | Derived from task-definition log group names and selected account/region; names default in task template | **External/derived — PENDING** | No | IAM execution-role log policies |
| `ApiEcrRepositoryArn` | `ecr-repositories.yaml` output `ApiRepositoryArn` | **Stack output — PENDING** | No | IAM image-pull policies |
| `FrontendBucketArn`, `CloudFrontDistributionArn` | `frontend-cloudfront.yaml` outputs of matching names | **Stack output — PENDING** | No | Frontend deploy-role policy |
| `GitHubOidcProviderArn` | Existing GitHub OIDC provider in selected AWS account | **External — PENDING verification** | No; identity metadata | IAM frontend deploy role trust |
| `GitHubFrontendOidcSubject` | Exact OIDC `sub` claim for repository staging environment | **External — PENDING verification** | No; identity policy metadata | IAM frontend deploy role trust |
| `ApiExecutionRoleArn`, `WorkerExecutionRoleArn`, `DbInitExecutionRoleArn`, `ApiTaskRoleArn`, `WorkerTaskRoleArn`, `DbInitTaskRoleArn`, `GitHubFrontendDeployRoleArn` | Outputs of `iam-roles.yaml` | **Stack output — PENDING** | No; role identifiers | Task-definition registration / GitHub frontend deployment |

## `ecs-task-definitions.yaml`

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `ImageTag` | Published full Git SHA; same backend image is used by API, worker, and DB-init | **External — PENDING** | No | Task-definition registration |
| `ApiRepositoryUri` | ECR output `ApiRepositoryUri` | **Stack output — PENDING** | No | Task-definition image reference |
| `ApiExecutionRoleArn`, `WorkerExecutionRoleArn`, `DbInitExecutionRoleArn`, `ApiTaskRoleArn`, `WorkerTaskRoleArn`, `DbInitTaskRoleArn` | Matching outputs from `iam-roles.yaml` | **Stack output — PENDING** | No; role identifiers | Task-definition registration |
| `ApiLogGroupName` (`/ecs/lead360/api`), `WorkerLogGroupName` (`/ecs/lead360/worker`), `DbInitLogGroupName` (`/ecs/lead360/db-init`) | Template defaults; corresponding ARNs are needed by IAM | **Documented defaults; confirm consistency** | No | Task-definition logs and IAM policies |
| `DatabaseHost` | `data-services.yaml` output `DatabaseEndpointAddress` | **Stack output — PENDING** | Private endpoint metadata | API, worker, DB-init connection |
| `DatabaseName`, `DatabaseUser` | Same selected values supplied to `data-services.yaml` as `DatabaseName`, `DatabaseUsername` | **External — PENDING** | Username is operational metadata | API, worker, DB-init connection |
| `DatabasePasswordSecretArn` | Same externally supplied secret ARN used by `data-services.yaml` | **External — PENDING** | **Yes—ARN reference only** | API, worker, DB-init secret injection |
| `RedisUrlSecretArn` | Secrets Manager secret containing a Redis/Valkey URL assembled with the private endpoint and auth | **External — PENDING** | **Yes—ARN reference only** | API and worker secret injection |
| `JwtSecretArn` | Secrets Manager secret holding the LeadFlow360 signing key | **External — PENDING** | **Yes—ARN reference only** | API secret injection |
| `FrontendOrigin` | HTTPS origin of chosen frontend domain | **External — PENDING** | No | API CORS/session configuration |
| `GoogleClientId`, `GoogleOAuthRedirectUri`, `GoogleOidcRedirectUri`, `GoogleOAuthScopes`, `GoogleOAuthResourceUrl` | Google configuration; callback URLs use chosen API domain and documented paths | **Optional; PENDING if Google integration enabled** | Client ID is public identifier; other values are not secrets | API task configuration |
| `GoogleClientSecretArn`, `GoogleTokenEncryptionKeySecretArn` | Secrets Manager references; required by template rules when `GoogleClientId` is set | **Optional; PENDING if Google integration enabled** | **Yes—ARN references only** | API secret injection |
| `JwtExpiresIn` (`1h`) | Template default | **Documented default** | No | API configuration |
| `ApiTaskDefinitionArn`, `WorkerTaskDefinitionArn`, `DbInitTaskDefinitionArn` | Outputs of `ecs-task-definitions.yaml` | **Stack output — PENDING** | No | ECS services and one-off DB-init task |

## `ecs-cluster.yaml`

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `ClusterName` (`lead360-staging`) | Template default; can be explicitly chosen | **Documented default** | No | ECS cluster creation |
| `EcsClusterArn`, `EcsClusterName` | Outputs of `ecs-cluster.yaml` | **Stack output — PENDING** | No | `EcsClusterArn` for DB-init `--cluster` and services `ClusterArn` |

## `ecs-services-alb.yaml`

| Exact parameter or output | Source/value | Status | Sensitive? | Needed for |
| --- | --- | --- | --- | --- |
| `ClusterArn` | `ecs-cluster.yaml` output `EcsClusterArn` | **Stack output — PENDING** | No | ALB/API/worker services creation |
| `VpcId`, `PublicSubnetIds`, `PrivateSubnetIds`, `AlbSecurityGroupId`, `ApiSecurityGroupId`, `WorkerSecurityGroupId` | Matching `networking.yaml` outputs | **Stack output — PENDING** | Network/security metadata | ALB/API/worker services creation |
| `ApiCertificateArn` | ACM certificate for API domain, in deployment region | **External — PENDING** | No; ARN metadata | HTTPS listener and services stack |
| `ApiTaskDefinitionArn`, `WorkerTaskDefinitionArn` | Matching outputs from `ecs-task-definitions.yaml` | **Stack output — PENDING** | No | API/worker service creation |
| `ApiDesiredCount` (`1`), `WorkerDesiredCount` (`1`) | Template defaults | **Documented defaults** | No | Services stack; review cost before provisioning |
| `ApiLoadBalancerDnsName`, `ApiLoadBalancerCanonicalHostedZoneId`, `ApiTargetGroupArn` | Outputs of `ecs-services-alb.yaml` | **Stack output — PENDING** | No | API DNS alias and post-deployment verification |

## DB-init task handoff

The initializer task definition already contains `NODE_ENV=production`,
`DATABASE_TYPE=postgres`, `DATABASE_SSL=true`, `DATABASE_HOST`, port `5432`,
`DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD` from
`DatabasePasswordSecretArn`. Its command is `npm run db:init` in
`/app/backend`. The `run-task` command needs only the `EcsClusterArn`,
`DbInitTaskDefinitionArn`, `PrivateSubnetIds`, and `DbInitSecurityGroupId`
values from the named outputs; do not pass password values as CLI overrides.
The security-group rules allow DB-init egress to PostgreSQL and RDS ingress
from the DB-init security group, but actual deployed connectivity is not
verified by this local manifest.

No values marked PENDING have been fetched from AWS or GitHub. This file is a
planning aid; it is not deployment approval and does not create resources.
