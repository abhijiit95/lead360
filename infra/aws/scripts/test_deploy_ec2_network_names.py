import ast
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).with_name("deploy-ec2-images.sh")
SCRIPT_SOURCE = SCRIPT_PATH.read_text(encoding="utf-8")
PYTHON_BLOCKS = re.findall(r"<<'PY'\n(.*?)\nPY", SCRIPT_SOURCE, flags=re.DOTALL)
if len(PYTHON_BLOCKS) != 2:
    raise RuntimeError(f"Expected two embedded Python blocks, found {len(PYTHON_BLOCKS)}")

PREFLIGHT_AST = ast.parse(PYTHON_BLOCKS[0])
FUNCTION_NAMES = {
    "has_network_dns_name",
    "network_mac_for_replacement",
    "healthcheck_docker_args",
}
FUNCTIONS = [
    node for node in PREFLIGHT_AST.body
    if isinstance(node, ast.FunctionDef) and node.name in FUNCTION_NAMES
]
if {node.name for node in FUNCTIONS} != FUNCTION_NAMES:
    raise RuntimeError("Could not find the network validation helpers in the deployment preflight")

NAMESPACE = {"re": re}
exec(compile(ast.Module(body=FUNCTIONS, type_ignores=[]), str(SCRIPT_PATH), "exec"), NAMESPACE)
has_network_dns_name = NAMESPACE["has_network_dns_name"]
network_mac_for_replacement = NAMESPACE["network_mac_for_replacement"]
healthcheck_docker_args = NAMESPACE["healthcheck_docker_args"]


class NetworkDnsNameTests(unittest.TestCase):
    def test_accepts_exact_name_in_aliases(self):
        endpoint = {"Aliases": ["lead360-api"]}
        self.assertTrue(has_network_dns_name(endpoint, "lead360-api"))
        self.assertIsNone(network_mac_for_replacement(endpoint, "lead360-api"))

    def test_accepts_exact_name_only_in_dns_names(self):
        endpoint = {
            "Aliases": ["ef5517cccc1f"],
            "DNSNames": ["lead360-api", "ef5517cccc1f"],
        }
        self.assertTrue(has_network_dns_name(endpoint, "lead360-api"))
        self.assertEqual(network_mac_for_replacement(endpoint, "lead360-api"), None)

    def test_rejects_name_absent_from_both_fields(self):
        endpoint = {"Aliases": ["lead360-api-other"], "DNSNames": ["lead360-api-staging"]}
        self.assertFalse(has_network_dns_name(endpoint, "lead360-api"))
        with self.assertRaisesRegex(ValueError, "lacks its required Docker DNS alias"):
            network_mac_for_replacement(endpoint, "lead360-api")

    def test_missing_or_null_fields_fail_safely(self):
        for endpoint in (None, {}, {"Aliases": None, "DNSNames": None}):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(ValueError):
                    network_mac_for_replacement(endpoint, "lead360-api")


class EndpointMacPreservationTests(unittest.TestCase):
    def test_accepts_verified_engine_25_endpoint_and_returns_mac(self):
        endpoint = {
            "Aliases": ["ef5517cccc1f"],
            "DNSNames": ["lead360-api", "ef5517cccc1f"],
            "Links": None,
            "DriverOpts": None,
            "MacAddress": "02:42:ac:12:00:04",
        }
        self.assertEqual(
            network_mac_for_replacement(endpoint, "lead360-api"),
            "02:42:ac:12:00:04",
        )

    def test_rejects_nonempty_links(self):
        endpoint = {
            "DNSNames": ["lead360-api"],
            "Links": ["legacy-link:alias"],
            "MacAddress": "02:42:ac:12:00:04",
        }
        with self.assertRaisesRegex(ValueError, "custom network links"):
            network_mac_for_replacement(endpoint, "lead360-api")

    def test_rejects_nonempty_driver_options(self):
        endpoint = {
            "DNSNames": ["lead360-api"],
            "DriverOpts": {"com.example.option": "value"},
            "MacAddress": "02:42:ac:12:00:04",
        }
        with self.assertRaisesRegex(ValueError, "custom network driver options"):
            network_mac_for_replacement(endpoint, "lead360-api")

    def test_rejects_malformed_mac_address(self):
        endpoint = {"DNSNames": ["lead360-api"], "MacAddress": "02:42:ac:12:00"}
        with self.assertRaisesRegex(ValueError, "invalid endpoint MAC address"):
            network_mac_for_replacement(endpoint, "lead360-api")

    def test_replacement_docker_run_preserves_endpoint_mac(self):
        inspect = [{
            "Id": "ef5517cccc1f1234567890abcdef1234567890abcdef1234567890abcdef1234",
            "Config": {"Entrypoint": None, "Cmd": ["nginx", "-g", "daemon off;"]},
            "NetworkSettings": {"Networks": {"lead360-network": {
                "Aliases": ["ef5517cccc1f"],
                "DNSNames": ["lead360-api", "ef5517cccc1f"],
                "MacAddress": "02:42:ac:12:00:04",
            }}},
        }]
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as inspect_file:
            json.dump(inspect, inspect_file)
            inspect_file.flush()
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as health_args_file:
                json.dump(["--no-healthcheck"], health_args_file)
                health_args_file.flush()
                fake_result = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
                argv = [
                    "replacement", "lead360-api", "image:sha", inspect_file.name,
                    "api.env", health_args_file.name, "4000", "",
                ]
                with patch.object(sys, "argv", argv):
                    with patch("subprocess.run", return_value=fake_result) as run:
                        with redirect_stdout(io.StringIO()):
                            exec(compile(PYTHON_BLOCKS[1], str(SCRIPT_PATH), "exec"), {})

        docker_args = run.call_args.args[0]
        mac_option = docker_args.index("--mac-address")
        self.assertEqual(docker_args[mac_option + 1], "02:42:ac:12:00:04")
        self.assertEqual(docker_args[docker_args.index("--network") + 1], "lead360-network")


class HealthcheckPreservationTests(unittest.TestCase):
    HEALTHCHECK = {
        "Test": ["CMD-SHELL", "curl --fail http://127.0.0.1:4000/api/health/ready"],
        "Interval": 30_000_000_000,
        "Timeout": 5_000_000_000,
        "Retries": 3,
        "StartPeriod": 10_000_000_000,
        "StartInterval": 2_000_000_000,
    }

    def test_preserves_shell_healthcheck_command_and_all_timing_fields(self):
        args = healthcheck_docker_args(self.HEALTHCHECK, "lead360-api")
        expected = {
            "--health-cmd": "curl --fail http://127.0.0.1:4000/api/health/ready",
            "--health-interval": "30000000000ns",
            "--health-timeout": "5000000000ns",
            "--health-retries": "3",
            "--health-start-period": "10000000000ns",
            "--health-start-interval": "2000000000ns",
        }
        self.assertEqual(
            {args[index]: args[index + 1] for index in range(0, len(args), 2)},
            expected,
        )
        self.assertNotIn("--no-healthcheck", args)

    def test_replacement_docker_run_includes_inspected_healthcheck(self):
        inspect = [{
            "Id": "ef5517cccc1f1234567890abcdef1234567890abcdef1234567890abcdef1234",
            "Config": {
                "Entrypoint": None,
                "Cmd": ["node", "dist/server.js"],
                "Healthcheck": self.HEALTHCHECK,
            },
            "NetworkSettings": {"Networks": {"lead360-network": {
                "Aliases": ["ef5517cccc1f"],
                "DNSNames": ["lead360-api", "ef5517cccc1f"],
                "MacAddress": "02:42:ac:12:00:04",
            }}},
        }]
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as inspect_file:
            json.dump(inspect, inspect_file)
            inspect_file.flush()
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as health_args_file:
                json.dump(healthcheck_docker_args(self.HEALTHCHECK, "lead360-api"), health_args_file)
                health_args_file.flush()
                fake_result = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
                argv = [
                    "replacement", "lead360-api", "image:sha", inspect_file.name,
                    "api.env", health_args_file.name, "4000", "",
                ]
                with patch.object(sys, "argv", argv):
                    with patch("subprocess.run", return_value=fake_result) as run:
                        with redirect_stdout(io.StringIO()):
                            exec(compile(PYTHON_BLOCKS[1], str(SCRIPT_PATH), "exec"), {})

        docker_args = run.call_args.args[0]
        self.assertIn("--health-cmd", docker_args)
        self.assertIn(self.HEALTHCHECK["Test"][1], docker_args)
        self.assertNotIn("--no-healthcheck", docker_args)
        for option in (
            "--health-interval",
            "--health-timeout",
            "--health-retries",
            "--health-start-period",
            "--health-start-interval",
        ):
            self.assertIn(option, docker_args)
        self.assertIn("--mac-address", docker_args)

    def test_none_healthcheck_is_disabled_for_api_and_frontend(self):
        for container_name in ("lead360-api", "lead360-frontend"):
            with self.subTest(container=container_name):
                self.assertEqual(
                    healthcheck_docker_args({"Test": ["NONE"]}, container_name),
                    ["--no-healthcheck"],
                )

    def test_replacement_keeps_none_healthcheck_disabled_for_both_containers(self):
        for name, port in (("lead360-api", "4000"), ("lead360-frontend", "8080")):
            with self.subTest(container=name):
                inspect = [{
                    "Id": "ef5517cccc1f1234567890abcdef1234567890abcdef1234567890abcdef1234",
                    "Config": {
                        "Entrypoint": None,
                        "Cmd": ["node", "dist/server.js"],
                        "Healthcheck": {"Test": ["NONE"]},
                    },
                    "NetworkSettings": {"Networks": {"lead360-network": {
                        "Aliases": ["ef5517cccc1f"],
                        "DNSNames": [name, "ef5517cccc1f"],
                        "MacAddress": "02:42:ac:12:00:04",
                    }}},
                }]
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as inspect_file:
                    json.dump(inspect, inspect_file)
                    inspect_file.flush()
                    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as health_args_file:
                        json.dump(healthcheck_docker_args({"Test": ["NONE"]}, name), health_args_file)
                        health_args_file.flush()
                        fake_result = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
                        argv = [
                            "replacement", name, "image:sha", inspect_file.name,
                            "runtime.env", health_args_file.name, port, "",
                        ]
                        with patch.object(sys, "argv", argv):
                            with patch("subprocess.run", return_value=fake_result) as run:
                                with redirect_stdout(io.StringIO()):
                                    exec(compile(PYTHON_BLOCKS[1], str(SCRIPT_PATH), "exec"), {})

                docker_args = run.call_args.args[0]
                self.assertIn("--no-healthcheck", docker_args)
                self.assertNotIn("--health-cmd", docker_args)
                self.assertEqual(docker_args[docker_args.index("--network") + 1], "lead360-network")

    def test_rejects_exec_form_because_cli_would_change_its_semantics(self):
        with self.assertRaisesRegex(ValueError, "exec-form Docker health check"):
            healthcheck_docker_args(
                {"Test": ["CMD", "curl", "--fail", "http://localhost/health"]},
                "lead360-api",
            )

    def test_rejects_malformed_or_unsupported_healthcheck(self):
        invalid_configs = (
            {},
            {"Test": None},
            {"Test": ["CMD-SHELL"]},
            {"Test": ["CMD-SHELL", "   "]},
            {"Test": ["CMD-SHELL", "curl /health"], "Interval": -1},
            {"Test": ["CMD-SHELL", "curl /health"], "Timeout": "5s"},
            {"Test": ["CMD-SHELL", "curl /health"], "Retries": True},
            {"Test": ["CMD-SHELL", "curl /health"], "FutureField": 1},
        )
        for config in invalid_configs:
            with self.subTest(config=config), self.assertRaises(ValueError):
                healthcheck_docker_args(config, "lead360-api")

    def test_rejects_nonzero_timing_values_on_disabled_healthcheck(self):
        with self.assertRaisesRegex(ValueError, "timing values on a disabled"):
            healthcheck_docker_args(
                {"Test": ["NONE"], "Interval": 1_000_000},
                "lead360-api",
            )


if __name__ == "__main__":
    unittest.main()
