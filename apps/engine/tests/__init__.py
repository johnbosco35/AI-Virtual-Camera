"""Engine tests. Run from apps/engine:  .venv\\Scripts\\python -m unittest discover -s tests -t . -v

Every test runs against a throw-away data directory (no model weights), so the real library,
avatars and voices are never touched and no downloads happen.
"""
import os
import tempfile

TEST_DATA_DIR = tempfile.mkdtemp(prefix="avs-engine-test-")
os.environ["AVS_DATA_DIR"] = TEST_DATA_DIR
os.environ["AVS_TOKEN"] = "test-token"
