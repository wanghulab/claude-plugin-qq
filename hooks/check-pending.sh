#!/bin/bash
# Stop hook: check for pending QQ messages after each Claude response
# Returns exit code 2 to trigger asyncRewake when messages are waiting
RESPONSE=$(curl -s http://127.0.0.1:6199/pending-messages 2>/dev/null)
COUNT=$(echo "$RESPONSE" | python -c "import sys,json; print(len(json.load(sys.stdin).get('messages',[])))" 2>/dev/null)
if [ "$COUNT" -gt 0 ] 2>/dev/null; then
  echo "[QQ] $COUNT 条待处理消息，请检查并回复。运行: curl -s http://127.0.0.1:6199/pending-messages"
  exit 2
fi
exit 0
