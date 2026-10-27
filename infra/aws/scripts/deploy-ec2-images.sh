#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

readonly REGION="us-east-1"
readonly ACCOUNT_ID="531767454878"
readonly REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
readonly NETWORK="lead360-network"
readonly API_NAME="lead360-api"
readonly FRONTEND_NAME="lead360-frontend"
readonly POSTGRES_NAME="lead360-postgres"
readonly REDIS_NAME="lead360-redis"

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected one full lowercase Git commit SHA."
  exit 2
fi
readonly DEPLOY_SHA="$1"
readonly API_IMAGE="${REGISTRY}/lead360-api:${DEPLOY_SHA}"
readonly FRONTEND_IMAGE="${REGISTRY}/lead360-frontend:${DEPLOY_SHA}"

for required in aws docker python3 curl base64 bash awk grep seq sleep mktemp chmod rm date; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Required EC2 command is unavailable: ${required}; no containers were changed."
    exit 1
  fi
done
if ! awk '$2 == "/run" && $3 == "tmpfs" { found = 1 } END { exit !found }' /proc/mounts; then
  echo "A memory-backed /run filesystem is required to hold temporary runtime env files; no containers were changed."
  exit 1
fi
if ! docker run --help 2>&1 | grep -q -- '--no-healthcheck'; then
  echo "Docker CLI lacks --no-healthcheck; no containers were changed."
  exit 1
fi

work_dir="$(mktemp -d /run/lead360-deploy.XXXXXXXX)"
chmod 700 "$work_dir"
cleanup() { rm -rf -- "$work_dir"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export DOCKER_CONFIG="${work_dir}/docker-config"
mkdir -m 700 "$DOCKER_CONFIG"

readonly API_INSPECT="${work_dir}/api-inspect.json"
readonly FRONTEND_INSPECT="${work_dir}/frontend-inspect.json"
readonly API_ENV_FILE="${work_dir}/api.env"
readonly FRONTEND_ENV_FILE="${work_dir}/frontend.env"

# Save inspected config only in a private, short-lived EC2 directory.
docker inspect "$API_NAME" > "$API_INSPECT"
docker inspect "$FRONTEND_NAME" > "$FRONTEND_INSPECT"
chmod 600 "$API_INSPECT" "$FRONTEND_INSPECT"

POSTGRES_BEFORE="$(docker inspect --format '{{.Id}}:{{.State.Running}}' "$POSTGRES_NAME")"
REDIS_BEFORE="$(docker inspect --format '{{.Id}}:{{.State.Running}}' "$REDIS_NAME")"
if [[ "$POSTGRES_BEFORE" != *:true || "$REDIS_BEFORE" != *:true ]]; then
  echo "PostgreSQL and Redis must both be running before deployment; no containers were changed."
  exit 1
fi

python3 - "$API_INSPECT" "$FRONTEND_INSPECT" "$API_ENV_FILE" "$FRONTEND_ENV_FILE" <<'PY'
import json
import os
import re
import sys

api_path, frontend_path, api_env_path, frontend_env_path = sys.argv[1:]
required_api_names = {
    "NODE_ENV", "PORT", "DATABASE_TYPE", "DATABASE_HOST", "DATABASE_PORT",
    "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_SSL",
    "DATABASE_CA_CERT_PATH", "REDIS_URL", "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET", "JWT_SECRET", "JWT_EXPIRES_IN", "FRONTEND_ORIGIN",
}


def fail(message):
    print(message)
    raise SystemExit(1)


def has_network_dns_name(endpoint, expected_name):
    if not isinstance(endpoint, dict):
        return False
    for field in ("Aliases", "DNSNames"):
        names = endpoint.get(field)
        if isinstance(names, list) and expected_name in names:
            return True
    return False


def load(path, expected_name, expected_port, required_names=()):
    try:
        info = json.load(open(path, encoding="utf-8"))[0]
    except Exception:
        fail(f"Could not read inspected configuration for {expected_name}; no containers were changed.")

    name = info.get("Name", "").lstrip("/")
    config = info.get("Config") or {}
    host = info.get("HostConfig") or {}
    state = info.get("State") or {}
    if name != expected_name or not state.get("Running"):
        fail(f"{expected_name} is missing, stopped, or has an unexpected name; no containers were changed.")
    if any(key.startswith("com.docker.compose.") for key in (config.get("Labels") or {})):
        fail(f"{expected_name} is Compose-managed, contrary to the verified configuration; no containers were changed.")
    if host.get("RestartPolicy", {}).get("Name") != "unless-stopped":
        fail(f"{expected_name} restart policy differs from the verified configuration; no containers were changed.")
    if host.get("NetworkMode") != "lead360-network":
        fail(f"{expected_name} network mode differs from the verified configuration; no containers were changed.")
    network_settings = info.get("NetworkSettings") or {}
    networks = network_settings.get("Networks") or {}
    if not isinstance(networks, dict) or set(networks) != {"lead360-network"}:
        fail(f"{expected_name} network attachments differ from the verified configuration; no containers were changed.")
    endpoint = networks.get("lead360-network")
    if not has_network_dns_name(endpoint, expected_name):
        fail(f"{expected_name} lacks its required Docker DNS alias; no containers were changed.")
    ipam = endpoint.get("IPAMConfig") or {}
    if any(ipam.get(field) for field in ("IPv4Address", "IPv6Address", "LinkLocalIPs")):
        fail(f"{expected_name} has a static network address that needs review; no containers were changed.")
    if endpoint.get("Links") or endpoint.get("DriverOpts") or endpoint.get("MacAddress"):
        fail(f"{expected_name} has custom network settings that need review; no containers were changed.")
    if config.get("Healthcheck"):
        fail(f"{expected_name} has a Docker health check not present in the verified configuration; no containers were changed.")
    if config.get("Tty") or config.get("OpenStdin") or config.get("AttachStdin"):
        fail(f"{expected_name} has interactive settings that need review; no containers were changed.")

    expected_bindings = {
        f"{expected_port}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(expected_port)}]
    }
    bindings = host.get("PortBindings") or {}
    normalized = {key: sorted(value, key=lambda item: (item.get("HostIp", ""), item.get("HostPort", "")))
                  for key, value in bindings.items() if value}
    if normalized != expected_bindings:
        fail(f"{expected_name} port binding differs from the verified configuration; no containers were changed.")

    mounts = info.get("Mounts") or []
    if expected_name == "lead360-api":
        if len(mounts) != 1:
            fail("lead360-api mount configuration differs from the verified configuration; no containers were changed.")
        mount = mounts[0]
        if not (mount.get("Type") == "bind"
                and mount.get("Source") == "/opt/lead360/tls/ca.crt"
                and mount.get("Destination") == "/run/secrets/postgres-ca.crt"
                and mount.get("RW") is False
                and os.path.isfile("/opt/lead360/tls/ca.crt")):
            fail("lead360-api CA bind mount differs from the verified configuration; no containers were changed.")
    elif mounts:
        fail("lead360-frontend has mounts not present in the verified configuration; no containers were changed.")

    env = config.get("Env") or []
    names = set()
    for item in env:
        if "=" not in item:
            fail(f"{expected_name} has an environment entry that cannot be preserved safely; no containers were changed.")
        key, value = item.split("=", 1)
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or "\n" in value or "\r" in value or value != value.strip():
            fail(f"{expected_name} environment cannot be represented safely in a protected env file; no containers were changed.")
        names.add(key)
    if not set(required_names).issubset(names):
        fail("lead360-api is missing a verified runtime variable name; no containers were changed.")

    env_path = api_env_path if expected_name == "lead360-api" else frontend_env_path
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        for item in env:
            stream.write(item + "\n")


load(api_path, "lead360-api", 4000, required_api_names)
load(frontend_path, "lead360-frontend", 8080)
print("Verified app container settings; environment values remain in private temporary files.")
PY

# Both immutable SHA images are authenticated and pulled before either app is stopped.
if ! aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null 2>&1; then
  echo "EC2 instance role could not authenticate to ECR; running containers were not changed."
  exit 1
fi
if ! docker pull --quiet "$API_IMAGE" >/dev/null 2>&1; then
  echo "Could not pull the API image for this SHA; running containers were not changed."
  exit 1
fi
if ! docker pull --quiet "$FRONTEND_IMAGE" >/dev/null 2>&1; then
  echo "Could not pull the frontend image for this SHA; running containers were not changed."
  exit 1
fi

start_replacement() {
  local name="$1" image="$2" inspect_file="$3" env_file="$4" port="$5" mount_spec="${6:-}"
  python3 - "$name" "$image" "$inspect_file" "$env_file" "$port" "$mount_spec" <<'PY'
import json
import subprocess
import sys

name, image, inspect_path, env_path, port, mount_spec = sys.argv[1:]
info = json.load(open(inspect_path, encoding="utf-8"))[0]
config = info["Config"]
endpoint = info["NetworkSettings"]["Networks"]["lead360-network"]
args = [
    "docker", "run", "--detach", "--name", name,
    "--restart", "unless-stopped", "--network", "lead360-network",
    "--publish", f"127.0.0.1:{port}:{port}/tcp",
    "--env-file", env_path, "--no-healthcheck",
]
for alias in endpoint.get("Aliases") or []:
    if alias != info.get("Id") and alias != info.get("Id", "")[:12]:
        args.extend(["--network-alias", alias])
if config.get("User"):
    args.extend(["--user", config["User"]])
if config.get("WorkingDir"):
    args.extend(["--workdir", config["WorkingDir"]])
if mount_spec:
    args.extend(["--mount", mount_spec])
entrypoint = config.get("Entrypoint") or []
command = config.get("Cmd") or []
if entrypoint:
    args.extend(["--entrypoint", entrypoint[0]])
    command = entrypoint[1:] + command
args.append(image)
args.extend(command)
result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
if result.returncode:
    print(f"Could not start {name} (docker exit {result.returncode}); no automatic rollback was attempted.")
    raise SystemExit(1)
print(f"Started {name} from the requested commit image.")
PY
}

wait_for_http() {
  local name="$1" url="$2" attempt
  for attempt in $(seq 1 60); do
    if [[ "$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || true)" == "true" ]] \
      && curl --fail --silent --show-error --max-time 5 --output /dev/null "$url" 2>/dev/null; then
      echo "${name} is running and its HTTP health endpoint responded successfully."
      return 0
    fi
    sleep 5
  done
  echo "${name} did not pass its HTTP/container health check; no automatic rollback was attempted."
  return 1
}

replace_container() {
  local name="$1" image="$2" inspect_file="$3" env_file="$4" port="$5" mount_spec="${6:-}"
  local current_image backup_name
  current_image="$(docker inspect --format '{{.Config.Image}}' "$name")"
  if [[ "$current_image" == "$image" ]]; then
    echo "${name} already uses the requested SHA image; checking health without replacement."
    return 0
  fi

  backup_name="${name}-previous-${DEPLOY_SHA:0:12}-$(date -u +%Y%m%d%H%M%S)"
  docker stop --time 30 "$name" >/dev/null
  docker rename "$name" "$backup_name"
  docker network disconnect --force "$NETWORK" "$backup_name" >/dev/null
  start_replacement "$name" "$image" "$inspect_file" "$env_file" "$port" "$mount_spec"
  echo "Previous ${name} container retained, stopped, and disconnected as ${backup_name}."
}

replace_container "$API_NAME" "$API_IMAGE" "$API_INSPECT" "$API_ENV_FILE" 4000 \
  "type=bind,source=/opt/lead360/tls/ca.crt,target=/run/secrets/postgres-ca.crt,readonly"
wait_for_http "$API_NAME" "http://127.0.0.1:4000/api/health/ready"

replace_container "$FRONTEND_NAME" "$FRONTEND_IMAGE" "$FRONTEND_INSPECT" "$FRONTEND_ENV_FILE" 8080
wait_for_http "$FRONTEND_NAME" "http://127.0.0.1:8080/"
wait_for_http "$FRONTEND_NAME" "http://127.0.0.1:8080/api/health/ready"

POSTGRES_AFTER="$(docker inspect --format '{{.Id}}:{{.State.Running}}' "$POSTGRES_NAME")"
REDIS_AFTER="$(docker inspect --format '{{.Id}}:{{.State.Running}}' "$REDIS_NAME")"
if [[ "$POSTGRES_BEFORE" != "$POSTGRES_AFTER" || "$REDIS_BEFORE" != "$REDIS_AFTER" ]]; then
  echo "PostgreSQL or Redis container identity/state changed during deployment; investigate immediately."
  exit 1
fi

echo "Deployment verified for commit ${DEPLOY_SHA}; PostgreSQL and Redis container IDs and running state are unchanged."
