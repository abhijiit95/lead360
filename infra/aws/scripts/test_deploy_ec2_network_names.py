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
FUNCTION_NAMES = {"has_network_dns_name", "network_mac_for_replacement"}
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
            fake_result = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
            with patch.object(sys, "argv", ["replacement", "lead360-api", "image:sha", inspect_file.name, "api.env", "4000", ""]):
                with patch("subprocess.run", return_value=fake_result) as run:
                    with redirect_stdout(io.StringIO()):
                        exec(compile(PYTHON_BLOCKS[1], str(SCRIPT_PATH), "exec"), {})

        docker_args = run.call_args.args[0]
        mac_option = docker_args.index("--mac-address")
        self.assertEqual(docker_args[mac_option + 1], "02:42:ac:12:00:04")
        self.assertEqual(docker_args[docker_args.index("--network") + 1], "lead360-network")


if __name__ == "__main__":
    unittest.main()
