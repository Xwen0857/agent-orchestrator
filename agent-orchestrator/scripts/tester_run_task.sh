#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

TASK_ID="$(jq -r '.id' "$META")"
DELIVERY_DIR="$TASK_DIR/delivery"
RESULT_JSON="$TASK_DIR/tester_result.json"

if [[ ! -d "$DELIVERY_DIR" ]]; then
  echo "delivery directory missing for tester"
  {
    echo "- Commands: cd delivery && python3 -m unittest -q <test_files>"
    echo "- Result: FAIL"
    echo "- Evidence: delivery directory missing"
  } >> "$TASK_DIR/test.md"
  jq -n --arg task_id "$TASK_ID" --arg status "FAIL" --arg details "delivery directory missing" '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
  exit 1
fi

TEST_FILES=()
while IFS= read -r test_file; do
  TEST_FILES+=("$test_file")
done < <(find "$DELIVERY_DIR" -maxdepth 1 -type f -name "test*.py" -exec basename {} \; | sort)
if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  while IFS= read -r test_file; do
    TEST_FILES+=("$test_file")
  done < <(find "$DELIVERY_DIR" -maxdepth 1 -type f -name "*_test.py" -exec basename {} \; | sort)
fi
if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "no python test files found in delivery"
  {
    echo "- Commands: cd delivery && python3 -m unittest -q <test_files>"
    echo "- Result: FAIL"
    echo "- Evidence: no test files matching test*.py or *_test.py"
  } >> "$TASK_DIR/test.md"
  jq -n \
    --arg task_id "$TASK_ID" \
    --arg status "FAIL" \
    --arg details "no test files matching test*.py or *_test.py" \
    '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
  exit 1
fi

CMD="cd delivery && python3 -m unittest -q ${TEST_FILES[*]}"
set +e
OUT="$(cd "$DELIVERY_DIR" && python3 -m unittest -q "${TEST_FILES[@]}" 2>&1)"
CODE=$?
set -e

{
  echo "- Commands: $CMD"
  if [[ $CODE -eq 0 ]]; then
    echo "- Result: PASS"
  else
    echo "- Result: FAIL"
  fi
  echo "- Evidence: $OUT"
} >> "$TASK_DIR/test.md"

if [[ $CODE -eq 0 ]]; then
  jq -n --arg task_id "$TASK_ID" --arg status "PASS" --arg details "$OUT" '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
  echo "tester pass: $TASK_ID"
  exit 0
fi

jq -n --arg task_id "$TASK_ID" --arg status "FAIL" --arg details "$OUT" '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
echo "tester fail: $TASK_ID"
exit 1
