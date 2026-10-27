import ast
from pathlib import Path
import re
import unittest


SCRIPT_PATH = Path(__file__).with_name("deploy-ec2-images.sh")
SCRIPT_SOURCE = SCRIPT_PATH.read_text(encoding="utf-8")
PREFLIGHT_BLOCK = re.search(r"<<'PY'\n(.*?)\nPY", SCRIPT_SOURCE, flags=re.DOTALL)
if PREFLIGHT_BLOCK is None:
    raise RuntimeError("Could not find the deployment preflight Python block")

PREFLIGHT_AST = ast.parse(PREFLIGHT_BLOCK.group(1))
DNS_NAME_FUNCTION = next(
    (node for node in PREFLIGHT_AST.body
     if isinstance(node, ast.FunctionDef) and node.name == "has_network_dns_name"),
    None,
)
if DNS_NAME_FUNCTION is None:
    raise RuntimeError("Could not find has_network_dns_name in the deployment preflight")

FUNCTION_MODULE = ast.Module(body=[DNS_NAME_FUNCTION], type_ignores=[])
NAMESPACE = {}
exec(compile(FUNCTION_MODULE, str(SCRIPT_PATH), "exec"), NAMESPACE)
has_network_dns_name = NAMESPACE["has_network_dns_name"]


class NetworkDnsNameTests(unittest.TestCase):
    def test_accepts_exact_name_in_aliases(self):
        self.assertTrue(has_network_dns_name({"Aliases": ["lead360-api"]}, "lead360-api"))

    def test_accepts_exact_name_only_in_dns_names(self):
        self.assertTrue(
            has_network_dns_name(
                {"Aliases": ["ef5517cccc1f"], "DNSNames": ["lead360-api", "ef5517cccc1f"]},
                "lead360-api",
            )
        )

    def test_rejects_name_absent_from_both_fields(self):
        self.assertFalse(
            has_network_dns_name(
                {"Aliases": ["lead360-api-other"], "DNSNames": ["lead360-api-staging"]},
                "lead360-api",
            )
        )

    def test_missing_or_null_fields_fail_safely(self):
        for endpoint in (None, {}, {"Aliases": None, "DNSNames": None}):
            with self.subTest(endpoint=endpoint):
                self.assertFalse(has_network_dns_name(endpoint, "lead360-api"))

    def test_non_list_fields_do_not_use_substring_matching(self):
        self.assertFalse(
            has_network_dns_name(
                {"Aliases": "lead360-api-other", "DNSNames": "lead360-api-staging"},
                "lead360-api",
            )
        )


if __name__ == "__main__":
    unittest.main()
