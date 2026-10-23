"""Signs Claude Code in to an MCP server with OAuth by driving its terminal UI (`/mcp`, then Authenticate).

Claude Code has no command for this, so the UI is run in a pseudo-terminal. The user's browser is replaced by a
BROWSER script that records the authorization URL; this script prints it, and exits once Claude Code says the
sign-in is done. Usage: claude-login.py HOME MCP_CONFIG_JSON
"""

import fcntl
import json
import os
import pty
import re
import select
import struct
import sys
import termios
import time

home, mcp_config = sys.argv[1], sys.argv[2]
work = os.path.join(home, "work")
os.makedirs(work, exist_ok=True)

# Skip the first-run screens: onboarding, the folder trust prompt and the approval of an API key from the environment.
with open(os.path.join(home, ".claude.json"), "w") as f:
    json.dump(
        {
            "hasCompletedOnboarding": True,
            "theme": "dark",
            "projects": {work: {"hasTrustDialogAccepted": True}},
            "customApiKeyResponses": {"approved": [os.environ["ANTHROPIC_API_KEY"][-20:]], "rejected": []},
        },
        f,
    )

url_file = os.path.join(home, "authorization-url")
browser = os.path.join(home, "browser.sh")
with open(browser, "w") as f:
    f.write('#!/bin/sh\necho "$1" > "%s"\n' % url_file)
os.chmod(browser, 0o755)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(work)
    os.environ["BROWSER"] = browser
    os.execvp("claude", ["claude", "--mcp-config", mcp_config, "--strict-mcp-config"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 140, 0, 0))

ANSI = re.compile(r"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]")
screen = ""


def read(seconds):
    """Reads what the UI prints for a while and keeps the text, without escape codes, in `screen`."""
    global screen
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        if not data:
            return
        screen = (screen + ANSI.sub("", data.decode(errors="replace")))[-20000:]


def wait_for(text, seconds):
    """Waits until `text` is on the screen; the UI redraws in place, so spaces and a few letters can be missing."""
    end = time.time() + seconds
    while time.time() < end:
        if text in screen.replace(" ", ""):
            return True
        read(0.5)
    return False


def fail(message):
    print("claude-login: " + message + "\n--- screen ---\n" + screen[-3000:], file=sys.stderr)
    os.kill(pid, 9)
    sys.exit(1)


def stored_credentials():
    """Whether Claude Code has saved an MCP OAuth access token (it saves the registered client before that)."""
    try:
        with open(os.path.join(home, ".claude", ".credentials.json")) as f:
            servers = json.load(f).get("mcpOAuth", {})
    except (OSError, ValueError):
        return False
    return any(server.get("accessToken") for server in servers.values())


def press(keys, pause):
    os.write(fd, keys)
    read(pause)


if not wait_for("/effort", 30):
    fail("the UI never became ready")
read(2)
press(b"/mcp\r", 3)
press(b"\r", 3)  # the only server
press(b"\r", 1)  # its first option is Authenticate

end = time.time() + 20
while time.time() < end and not os.path.exists(url_file):
    read(0.5)
if not os.path.exists(url_file):
    fail("no authorization URL was opened")
print(open(url_file).read().strip(), flush=True)

end = time.time() + 60
while time.time() < end and not stored_credentials():
    read(0.5)
if not stored_credentials():
    fail("Claude Code never saved the credentials")
# The UI notes that the server needed authentication and skips it for a while; that is over now.
os.kill(pid, 9)
os.waitpid(pid, 0)
try:
    os.remove(os.path.join(home, ".claude", "mcp-needs-auth-cache.json"))
except OSError:
    pass
