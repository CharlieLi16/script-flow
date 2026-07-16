#!/usr/bin/env bash
# Auto-detect WSL host gateway and use local proxy on :17891
HOST_IP="${HOST_IP:-$(ip route | awk '/default/{print $3; exit}')}"
if [ -z "$HOST_IP" ]; then
  echo "HOST_IP not found" >&2
  exit 1
fi
export HOST_IP
export http_proxy="http://${HOST_IP}:17891"
export https_proxy="http://${HOST_IP}:17891"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
export ALL_PROXY="$http_proxy"
export NO_PROXY="localhost,127.0.0.1"
exec "$@"
