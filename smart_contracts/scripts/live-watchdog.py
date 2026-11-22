#!/usr/bin/env python3
"""Stream live tasks and supervise their whole process group, keeping headers clean."""
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def run(args, root, emit):
    if args[0] in ('e2e:flows', 'e2e:latency', 'e2e:edge', 'e2e:scale'):
        health = subprocess.run(['bash', 'scripts/scan-health.sh'], cwd=root, capture_output=True, text=True, timeout=90)
        for line in (health.stdout + health.stderr).splitlines(): emit(line)
        if health.returncode: return health.returncode
    if args[0] == '--node': command = ['node', *args[1:]]
    elif args[0] == '--command': command = args[1:]  # deterministic offline tests
    else: command = ['npx', '--no-install', 'hardhat', *args]
    if not command: raise SystemExit('empty command')
    idle_limit = float(os.environ.get('LIVE_IDLE_SECONDS', '300'))
    wait_limit = float(os.environ.get('LIVE_WAIT_SECONDS', '480'))
    heartbeat = float(os.environ.get('LIVE_HEARTBEAT_SECONDS', '30'))
    grace = float(os.environ.get('LIVE_INTERRUPT_GRACE_SECONDS', '30'))
    emit(f'Watchdog idle={idle_limit:g}s waiting={wait_limit:g}s heartbeat={heartbeat:g}s')
    child = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    last_activity = last_heartbeat = time.monotonic()
    last_line = '(no child output yet)'
    wait_start = interrupted = killed = None
    reason = None
    pending = b''
    stdout_open = True
    def interrupt(why):
        nonlocal interrupted, reason
        if interrupted is None and group_alive(child.pid):
            interrupted = time.monotonic()
            reason = why
            emit(f'Watchdog STOP: {why}; SIGINT process group {child.pid}')
            try: os.killpg(child.pid, signal.SIGINT)
            except ProcessLookupError: pass
    def on_signal(sig, _frame): interrupt(f'external {signal.Signals(sig).name}')
    old = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        while True:
            for key, _ in selector.select(timeout=0.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    stdout_open = False
                    selector.unregister(key.fileobj)
                    break
                pending += chunk
                while b'\n' in pending:
                    raw, pending = pending.split(b'\n', 1)
                    line = raw.decode('utf8', errors='replace')
                    last_activity = time.monotonic()
                    last_line = line
                    emit(line)
                    if re.search(r'scan HTTP 404|\bwaiting\b', line, re.I):
                        if wait_start is None: wait_start = last_activity
                    else: wait_start = None
            now = time.monotonic()
            leader_alive = child.poll() is None  # poll also reaps the launcher
            alive = group_alive(child.pid)
            if now - last_heartbeat >= heartbeat:
                last_heartbeat = now
                emit(f'Watchdog status: pid={child.pid} alive={alive} launcher_alive={leader_alive} silence={now-last_activity:.0f}s last={last_line}')
            if now - last_activity >= idle_limit: interrupt(f'no new child line for {idle_limit:g}s')
            if wait_start is not None and now - wait_start >= wait_limit: interrupt(f'repeated waiting/404 for {wait_limit:g}s')
            if interrupted is not None and now - interrupted >= grace and alive and killed is None:
                emit('Watchdog: SIGKILL surviving process group after checkpoint grace expired')
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                killed = now
            if not leader_alive and not stdout_open and (not alive or (killed is not None and now-killed >= 0.5)):
                break
        if pending: emit(pending.decode('utf8', errors='replace'))
        result = child.wait(timeout=2)
        emit(f'Watchdog exit={result}')
        return 130 if reason else (result if result >= 0 else 128 - result)
    finally:
        selector.close()
        child.stdout.close()
        for sig, handler in old.items(): signal.signal(sig, handler)


def main():
    args = sys.argv[1:]
    if not args: raise SystemExit('usage: scripts/live.sh <hardhat task args> | --node <script args>')
    root = Path(__file__).resolve().parent.parent
    label = re.sub(r'[^a-zA-Z0-9_-]', '-', args[0])
    filename = f'live-{label}-{time.time_ns()}.log'
    final = root / 'e2e_reports' / filename
    # Keep the active log outside git until the task has captured its clean run header.
    with tempfile.TemporaryDirectory(prefix='idpp-live-') as temp:
        active = Path(temp) / filename
        try:
            with active.open('w', buffering=1) as log:
                def emit(line):
                    print(line, flush=True)
                    log.write(line + '\n')
                emit(f'Active live log: {active}; archive after exit: {final}')
                return run(args, root, emit)
        finally:
            final.parent.mkdir(parents=True, exist_ok=True)
            if active.exists(): shutil.copyfile(active, final)


if __name__ == '__main__': sys.exit(main())
