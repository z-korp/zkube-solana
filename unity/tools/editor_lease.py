"""One lease covers asset mutation and the complete Editor operation."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path

LOCK_PATH = Path(__file__).resolve().parents[2] / "build/unity/editor.lock"
INHERITED_FD = "ZKUBE_EDITOR_LEASE_FD"


@contextmanager
def editor_lease():
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    inherited = os.environ.get(INHERITED_FD)
    if inherited is not None:
        fd = int(inherited)
        actual, expected = os.fstat(fd), LOCK_PATH.stat()
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise RuntimeError("Inherited Editor lease does not name editor.lock")
        # This uses the parent's open file description. A forged descriptor
        # still has to acquire the real lock; it cannot bypass a running Editor.
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Unity build/test operation is active") from None
        yield fd
        return
    with LOCK_PATH.open("a") as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Unity build/test operation is active") from None
        yield lease.fileno()
