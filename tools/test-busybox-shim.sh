#!/bin/sh

# Test-only BusyBox multicall shim for Git Bash. Android uses the real KernelSU BusyBox.
APPLET=$1
shift
exec "$APPLET" "$@"
